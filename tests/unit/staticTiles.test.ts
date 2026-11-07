import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTilesFromXml, tileToJson } from '../../scripts/build-tiles/build-tiles.mjs';
import {
  TILE_DEG,
  TILE_FORMAT_VERSION,
  resolveTileBaseUrl,
  resetTileResolution,
  setTileBaseUrl as _setTileBase,
  corridorTileRange,
  createTileMergeContext,
  fetchCorridorViaTiles,
  parseTileJson,
  setTileBaseUrl,
  tileKey,
  tilesInRange,
} from '../../src/lib/osm/staticTiles';
import { SnapIndex } from '../../src/lib/osm/snapIndex';
import type { WaysBundle } from '../../src/lib/osm/overpass';

const fixtureXml = readFileSync(
  join(import.meta.dirname, '..', 'fixtures', 'osm-api-map.xml'),
  'utf8',
);

/** Full round trip: OSM XML -> builder tiles -> provider merge -> snap index. */
async function buildBundleFromFixtureXml(): Promise<{
  bundle: WaysBundle;
  tiles: Map<string, unknown>;
}> {
  const { tiles } = await buildTilesFromXml(fixtureXml);
  const jsonTiles = new Map([...tiles.entries()].map(([key, tile]) => [key, tileToJson(tile)]));
  const bundle: WaysBundle = { nodes: new Map(), ways: [] };
  for (const json of jsonTiles.values()) parseTileJson(json, bundle);
  return { bundle, tiles: jsonTiles };
}

describe('corridorTileRange', () => {
  it('covers the padded bbox with tile indices', () => {
    const range = corridorTileRange([[8.002, 47.0002]], 0.018);
    expect(range).not.toBeNull();
    // 8.002±0.018 -> tile x 79..80; 47.0002±0.018 -> tile y 469..470
    expect(tilesInRange(range!)).toEqual([
      tileKey(79, 469),
      tileKey(79, 470),
      tileKey(80, 469),
      tileKey(80, 470),
    ]);
  });

  it('returns null for empty input and oversized corridors', () => {
    expect(corridorTileRange([], 0.018)).toBeNull();
    const wide: [number, number][] = [];
    for (let i = 0; i < 100; i++) wide.push([6.0 + i * 0.1, 47.0]);
    expect(corridorTileRange(wide, 0.02)).toBeNull();
  });
});

describe('builder round trip (XML -> tiles -> bundle -> snap)', () => {
  it('places ways in the tiles their geometry touches', async () => {
    const { tiles } = await buildBundleFromFixtureXml();
    // all fixture ways sit in lng 8.0–8.004 (tile x 80), lat 46.999–47.002
    // (tiles y 469 and 470)
    expect(tiles.has(tileKey(80, 470))).toBe(true);
    expect(tiles.has(tileKey(80, 469))).toBe(true);
    expect(tiles.size).toBe(2);
  });

  it('keeps tiles self-contained (full inline coordinates per way)', async () => {
    const { tiles } = await buildBundleFromFixtureXml();
    const y470 = tiles.get(tileKey(80, 470)) as {
      w: [number, [number, number][], Record<string, string>][];
    };
    for (const [, coords] of y470.w) {
      expect(coords.length).toBeGreaterThanOrEqual(2);
      for (const [lat, lng] of coords) {
        expect(Number.isFinite(lat)).toBe(true);
        expect(Number.isFinite(lng)).toBe(true);
      }
    }
  });

  it('round-trips through the provider merge into a working snap index', async () => {
    const { bundle } = await buildBundleFromFixtureXml();
    // track, path and residential are routable; footway (bicycle=no) filtered
    expect(bundle.ways.map((w) => w.id).sort()).toEqual([1001, 1002, 1003, 1004, 1005]);

    const index = new SnapIndex(bundle);
    const snap = index.snap(8.002, 47.0002 - 0.0002, 50); // ~22 m south of the track
    expect(snap).not.toBeNull();
    expect(snap!.wayId).toBe(1001);
    expect(snap!.lat).toBeCloseTo(47.0, 5);
  });

  it('filters tags down to the whitelist', async () => {
    const { tiles } = await buildBundleFromFixtureXml();
    const tile = tiles.get(tileKey(80, 470)) as {
      w: [number, [number, number][], Record<string, string>][];
    };
    const track = tile.w.find(([id]) => id === 1001)!;
    expect(track[2]).toEqual({ highway: 'track', surface: 'compacted', tracktype: 'grade2' });
  });

  it('synthesizes shared node ids so junctions survive the merge', async () => {
    // two ways meeting at one coordinate (the shared junction)
    const junctionXml = `<?xml version="1.0"?>
    <osm>
      <node id="1" lat="47.0" lon="8.0"/><node id="2" lat="47.0" lon="8.01"/>
      <node id="3" lat="47.01" lon="8.0"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="track"/></way>
      <way id="11"><nd ref="1"/><nd ref="3"/><tag k="highway" v="path"/></way>
    </osm>`;
    const { tiles } = await buildTilesFromXml(junctionXml);
    const bundle: WaysBundle = { nodes: new Map(), ways: [] };
    const ctx = createTileMergeContext();
    for (const tile of tiles.values()) parseTileJson(tileToJson(tile), bundle, ctx);
    expect(bundle.ways).toHaveLength(2);
    // both ways reference the same synthetic node for the junction (47.0, 8.0)
    const junctionA = bundle.ways[0]!.nodeIds[0];
    const junctionB = bundle.ways[1]!.nodeIds[0];
    expect(junctionA).toBe(junctionB);
    expect(bundle.nodes.size).toBe(3); // junction counted once
  });
});

describe('fetchCorridorViaTiles provider', () => {
  beforeAll(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('returns a merged bundle; 404 tiles (region edge) are skipped', async () => {
    const { tiles } = await buildBundleFromFixtureXml();
    const manifest = { formatVersion: TILE_FORMAT_VERSION, tileDeg: TILE_DEG };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
      const key = href.split('/').pop()!.replace('.json', '');
      const tile = tiles.get(key);
      // x=79 tiles don't exist — corridor pad reaches them (edge case)
      if (!tile) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(tile));
    });
    vi.stubGlobal('fetch', fetchMock);
    setTileBaseUrl('https://tiles.example/at/');

    try {
      const result = await fetchCorridorViaTiles([[8.002, 47.0002]], 2000);
      expect(result.status).toBe('ok');
      const bundle = (result as { status: 'ok'; bundle: WaysBundle }).bundle;
      expect(bundle.ways.map((w) => w.id).sort()).toEqual([1001, 1002, 1003, 1004, 1005]);
      const index = new SnapIndex(bundle);
      expect(index.snap(8.0015, 47.0, 10)!.wayId).toBe(1001);
      // manifest + 4 corridor tiles requested (x 79..80, y 469..470)
      expect(fetchMock.mock.calls.length).toBe(5);
    } finally {
      setTileBaseUrl('');
    }
  });

  it('reports region-miss when no tile in the corridor area exists', async () => {
    const manifest = { formatVersion: TILE_FORMAT_VERSION, tileDeg: TILE_DEG };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith('manifest.json')) {
          return new Response(JSON.stringify(manifest));
        }
        return new Response('not found', { status: 404 });
      }),
    );
    setTileBaseUrl('https://tiles.example/empty/');
    try {
      expect((await fetchCorridorViaTiles([[8.002, 47.0002]], 2000)).status).toBe('region-miss');
    } finally {
      setTileBaseUrl('');
    }
  });

  it('reports unreachable on server errors other than 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    setTileBaseUrl('https://tiles.example/broken/');
    try {
      expect((await fetchCorridorViaTiles([[8.002, 47.0002]], 2000)).status).toBe('unreachable');
    } finally {
      setTileBaseUrl('');
    }
  });

  it('reuses session-cached tiles when the corridor grows', async () => {
    resetTileResolution();
    const { tiles } = await buildBundleFromFixtureXml();
    const manifest = { formatVersion: TILE_FORMAT_VERSION, tileDeg: TILE_DEG };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const key = String(url).split('/').pop()!.replace('.json', '');
      if (String(url).endsWith('manifest.json')) {
        return new Response(JSON.stringify(manifest));
      }
      const tile = tiles.get(key);
      if (!tile) return new Response('nf', { status: 404 });
      return new Response(JSON.stringify(tile));
    });
    vi.stubGlobal('fetch', fetchMock);
    setTileBaseUrl('https://tiles.example/growth/');

    try {
      const r1 = await fetchCorridorViaTiles([[8.002, 47.0002]], 2000);
      if (r1?.status !== 'ok') throw new Error('expected ok');
      const count1 = fetchMock.mock.calls.length;

      // grow the corridor: a second waypoint one tile to the east
      const r2 = await fetchCorridorViaTiles(
        [
          [8.002, 47.0002],
          [8.25, 47.0002],
        ],
        2000,
      );
      const count2 = fetchMock.mock.calls.length;

      expect(count2).toBeGreaterThan(count1); // fetched the new tiles
      expect(count2 - count1).toBeLessThan(10); // but NOT the whole corridor again
      if (r2?.status !== 'ok') throw new Error('expected ok');
      expect(r2.bundle.ways.length).toBeGreaterThanOrEqual(
        r1.status === 'ok' ? r1.bundle.ways.length : 0,
      );
    } finally {
      setTileBaseUrl('');
    }
  });

  it('reports not-configured when no URL is set', async () => {
    setTileBaseUrl('');
    expect((await fetchCorridorViaTiles([[8.002, 47.0002]], 2000)).status).toBe('not-configured');
  });
});

describe('resolveTileBaseUrl auto-discovery', () => {
  beforeAll(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
    // page at a SUBFOLDER deploy: mydomain.com/mtb-router/
    vi.stubGlobal('window', {
      location: { origin: 'https://app.test', href: 'https://app.test/mtb-router/' },
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const manifest = { formatVersion: TILE_FORMAT_VERSION, tileDeg: TILE_DEG };

  /** responses keyed by the tile FOLDER NAME (tiles / mtb-tiles) */
  function mockAutoDiscovery(folders: Record<string, unknown>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const m = /[/]([^/]+)\/manifest\.json$/.exec(String(url));
        if (m) {
          const value = folders[m[1]!];
          if (value === 404 || value === undefined) return new Response('nf', { status: 404 });
          return new Response(JSON.stringify(value));
        }
        return new Response('nf', { status: 404 });
      }),
    );
  }

  it('discovers tiles next to the page in a subfolder deploy', async () => {
    resetTileResolution();
    mockAutoDiscovery({ tiles: manifest });
    expect(await resolveTileBaseUrl()).toBe('https://app.test/mtb-router/tiles');
  });

  it('falls through to mtb-tiles and the domain root when tiles is missing', async () => {
    resetTileResolution();
    mockAutoDiscovery({ tiles: 404, 'mtb-tiles': manifest });
    expect(await resolveTileBaseUrl()).toBe('https://app.test/mtb-router/mtb-tiles');
  });

  it('rejects candidates with a wrong manifest format', async () => {
    resetTileResolution();
    mockAutoDiscovery({ tiles: { formatVersion: 1, tileDeg: TILE_DEG }, 'mtb-tiles': manifest });
    expect(await resolveTileBaseUrl()).toBe('https://app.test/mtb-router/mtb-tiles');
  });

  it('returns null when nothing matches', async () => {
    resetTileResolution();
    mockAutoDiscovery({});
    expect(await resolveTileBaseUrl()).toBeNull();
  });

  it('caches the session resolution (no re-probing)', async () => {
    resetTileResolution();
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        calls++;
        if (/[/]tiles\/manifest\.json$/.test(String(url))) {
          return new Response(JSON.stringify(manifest));
        }
        return new Response('nf', { status: 404 });
      }),
    );
    await resolveTileBaseUrl();
    const afterFirst = calls;
    await resolveTileBaseUrl();
    await resolveTileBaseUrl();
    expect(calls).toBe(afterFirst); // no additional probes
  });

  it('explicit setting wins over discovery without probing', async () => {
    resetTileResolution();
    const fetchMock = vi.fn(async () => new Response('nf', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    setTileBaseUrl('https://elsewhere.example/at');
    expect(await resolveTileBaseUrl()).toBe('https://elsewhere.example/at');
    expect(fetchMock).not.toHaveBeenCalled();
    setTileBaseUrl('');
    resetTileResolution();
  });
});

describe('fetchCorridorViaTiles provider', () => {
  beforeAll(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('returns a merged bundle; 404 tiles (region edge) are skipped', async () => {
    const { tiles } = await buildBundleFromFixtureXml();
    const manifest = { formatVersion: TILE_FORMAT_VERSION, tileDeg: TILE_DEG };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
      const key = href.split('/').pop()!.replace('.json', '');
      const tile = tiles.get(key);
      // x=79 tiles don't exist — corridor pad reaches them (edge case)
      if (!tile) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(tile));
    });
    vi.stubGlobal('fetch', fetchMock);
    setTileBaseUrl('https://tiles.example/at/');

    try {
      const result = await fetchCorridorViaTiles([[8.002, 47.0002]], 2000);
      expect(result.status).toBe('ok');
      const bundle = (result as { status: 'ok'; bundle: WaysBundle }).bundle;
      expect(bundle.ways.map((w) => w.id).sort()).toEqual([1001, 1002, 1003, 1004, 1005]);
      const index = new SnapIndex(bundle);
      expect(index.snap(8.0015, 47.0, 10)!.wayId).toBe(1001);
      // manifest + 4 corridor tiles requested (x 79..80, y 469..470)
      expect(fetchMock.mock.calls.length).toBe(5);
    } finally {
      setTileBaseUrl('');
    }
  });

  it('reports region-miss when no tile in the corridor area exists', async () => {
    const manifest = { formatVersion: TILE_FORMAT_VERSION, tileDeg: TILE_DEG };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith('manifest.json')) {
          return new Response(JSON.stringify(manifest));
        }
        return new Response('not found', { status: 404 });
      }),
    );
    setTileBaseUrl('https://tiles.example/empty/');
    try {
      expect((await fetchCorridorViaTiles([[8.002, 47.0002]], 2000)).status).toBe('region-miss');
    } finally {
      setTileBaseUrl('');
    }
  });

  it('reports unreachable on server errors other than 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    setTileBaseUrl('https://tiles.example/broken/');
    try {
      expect((await fetchCorridorViaTiles([[8.002, 47.0002]], 2000)).status).toBe('unreachable');
    } finally {
      setTileBaseUrl('');
    }
  });

  it('reuses session-cached tiles when the corridor grows', async () => {
    resetTileResolution();
    const { tiles } = await buildBundleFromFixtureXml();
    const manifest = { formatVersion: TILE_FORMAT_VERSION, tileDeg: TILE_DEG };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const key = String(url).split('/').pop()!.replace('.json', '');
      if (String(url).endsWith('manifest.json')) {
        return new Response(JSON.stringify(manifest));
      }
      const tile = tiles.get(key);
      if (!tile) return new Response('nf', { status: 404 });
      return new Response(JSON.stringify(tile));
    });
    vi.stubGlobal('fetch', fetchMock);
    setTileBaseUrl('https://tiles.example/growth/');

    try {
      const r1 = await fetchCorridorViaTiles([[8.002, 47.0002]], 2000);
      if (r1?.status !== 'ok') throw new Error('expected ok');
      const count1 = fetchMock.mock.calls.length;

      // grow the corridor: a second waypoint one tile to the east
      const r2 = await fetchCorridorViaTiles(
        [
          [8.002, 47.0002],
          [8.25, 47.0002],
        ],
        2000,
      );
      const count2 = fetchMock.mock.calls.length;

      expect(count2).toBeGreaterThan(count1); // fetched the new tiles
      expect(count2 - count1).toBeLessThan(10); // but NOT the whole corridor again
      if (r2?.status !== 'ok') throw new Error('expected ok');
      expect(r2.bundle.ways.length).toBeGreaterThanOrEqual(
        r1.status === 'ok' ? r1.bundle.ways.length : 0,
      );
    } finally {
      setTileBaseUrl('');
    }
  });

  it('reports not-configured when no URL is set', async () => {
    setTileBaseUrl('');
    expect((await fetchCorridorViaTiles([[8.002, 47.0002]], 2000)).status).toBe('not-configured');
  });
});

describe('resolveTileBaseUrl auto-discovery', () => {
  beforeAll(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
    vi.stubGlobal('window', { location: { origin: 'https://app.test' } });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const manifest = { formatVersion: TILE_FORMAT_VERSION, tileDeg: TILE_DEG };

  function mockHost(probed: Record<string, unknown>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const key = String(url)
          .replace('https://app.test', '')
          .replace(/\/manifest\.json$/, '')
          .replace(/^\//, '');
        if (key in probed) {
          const value = probed[key]!;
          return value === 404
            ? new Response('nf', { status: 404 })
            : new Response(JSON.stringify(value));
        }
        return new Response('nf', { status: 404 });
      }),
    );
  }

  it('discovers the first candidate with a valid manifest', async () => {
    resetTileResolution();
    mockHost({ tiles: manifest, 'mtb-tiles': 404, '/tiles': 404, '/mtb-tiles': 404 });
    expect(await resolveTileBaseUrl()).toBe('https://app.test/tiles');
  });

  it('falls through to later candidates when the first is missing', async () => {
    resetTileResolution();
    mockHost({ tiles: 404, 'mtb-tiles': manifest });
    expect(await resolveTileBaseUrl()).toBe('https://app.test/mtb-tiles');
  });

  it('rejects candidates with a wrong manifest format', async () => {
    resetTileResolution();
    mockHost({ tiles: { formatVersion: 1, tileDeg: TILE_DEG }, 'mtb-tiles': manifest });
    expect(await resolveTileBaseUrl()).toBe('https://app.test/mtb-tiles');
  });

  it('returns null when nothing matches', async () => {
    resetTileResolution();
    mockHost({});
    expect(await resolveTileBaseUrl()).toBeNull();
  });

  it('caches the session resolution (no re-probing)', async () => {
    resetTileResolution();
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const key = String(url)
        .replace('https://app.test', '')
        .replace(/\/manifest\.json$/, '')
        .replace(/^\//, '');
      return key === 'tiles'
        ? new Response(JSON.stringify(manifest))
        : new Response('nf', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await resolveTileBaseUrl();
    const afterFirst = fetchMock.mock.calls.length;
    await resolveTileBaseUrl();
    await resolveTileBaseUrl();
    expect(fetchMock.mock.calls.length).toBe(afterFirst); // no additional probes
  });

  it('explicit setting wins over discovery without probing', async () => {
    resetTileResolution();
    const fetchMock = vi.fn(async () => new Response('nf', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    setTileBaseUrl('https://elsewhere.example/at');
    expect(await resolveTileBaseUrl()).toBe('https://elsewhere.example/at');
    expect(fetchMock).not.toHaveBeenCalled();
    setTileBaseUrl('');
    resetTileResolution();
  });
});
