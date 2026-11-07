import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ownBasemapUrl,
  probeOwnBasemap,
  rewriteStyleForOwnBasemap,
} from '../../src/lib/map/ownBasemap';

const style = {
  version: 8,
  name: 'Bright',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    },
    ne2_shaded: {
      type: 'raster',
      tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'],
    },
  },
  layers: [
    { id: 'background', type: 'background' },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
  ],
};

const PMTILES_URL = 'https://mydomain.com/mtb-router/tiles/basemap.pmtiles';

afterEach(() => vi.unstubAllGlobals());

describe('own-basemap style rewrite', () => {
  it('points the vector source at the own PMTiles archive', () => {
    const rewritten = rewriteStyleForOwnBasemap(style, PMTILES_URL) as typeof style;
    expect(rewritten.sources.openmaptiles.url).toBe(`pmtiles://${PMTILES_URL}`);
    expect(rewritten.sources.openmaptiles.type).toBe('vector');
  });

  it('keeps glyphs, raster sources and layers untouched', () => {
    const rewritten = rewriteStyleForOwnBasemap(style, PMTILES_URL) as typeof style;
    expect(rewritten.glyphs).toBe(style.glyphs);
    expect(rewritten.sources.ne2_shaded.tiles).toEqual(style.sources.ne2_shaded.tiles);
    expect(rewritten.layers).toEqual(style.layers);
  });

  it('does not mutate the input style', () => {
    rewriteStyleForOwnBasemap(style, PMTILES_URL);
    expect(style.sources.openmaptiles.url).toBe('https://tiles.openfreemap.org/planet');
  });

  it('survives a style without sources (defensive)', () => {
    expect(() => rewriteStyleForOwnBasemap({ version: 8 }, PMTILES_URL)).not.toThrow();
  });

  it('builds the archive URL from a tile base', () => {
    expect(ownBasemapUrl('https://mydomain.com/mtb-router/tiles')).toBe(
      'https://mydomain.com/mtb-router/tiles/basemap.pmtiles',
    );
    expect(ownBasemapUrl('https://mydomain.com/mtb-router/tiles/')).toBe(
      'https://mydomain.com/mtb-router/tiles/basemap.pmtiles',
    );
  });
});

describe('probeOwnBasemap (content validation)', () => {
  // PMTiles magic: first two bytes "PM" (0x50 0x4d) — same as the library's check
  function pmtilesBytes(): ArrayBuffer {
    const bytes = new Uint8Array(512);
    bytes[0] = 0x50; // 'P'
    bytes[1] = 0x4d; // 'M'
    return bytes.buffer;
  }

  function stubFetch(respond: () => Promise<Response>): void {
    vi.stubGlobal('fetch', vi.fn(respond));
  }

  it('accepts a 206 response with valid PMTiles magic', async () => {
    stubFetch(() => Promise.resolve(new Response(pmtilesBytes(), { status: 206 })));
    expect(await probeOwnBasemap('https://app.test/tiles')).toBe(
      'https://app.test/tiles/basemap.pmtiles',
    );
  });

  it('rejects an SPA-fallback HTML response (200, no magic)', async () => {
    stubFetch(() => Promise.resolve(new Response('<!doctype html>', { status: 200 })));
    expect(await probeOwnBasemap('https://app.test/tiles')).toBeNull();
  });

  it('rejects 206 responses without the PMTiles magic', async () => {
    stubFetch(() => Promise.resolve(new Response(new Uint8Array(512), { status: 206 })));
    expect(await probeOwnBasemap('https://app.test/tiles')).toBeNull();
  });

  it('rejects full-file 200 responses (server ignores ranges — PMTiles unusable)', async () => {
    stubFetch(() => Promise.resolve(new Response(pmtilesBytes(), { status: 200 })));
    expect(await probeOwnBasemap('https://app.test/tiles')).toBeNull();
  });

  it('rejects 404', async () => {
    stubFetch(() => Promise.resolve(new Response('nf', { status: 404 })));
    expect(await probeOwnBasemap('https://app.test/tiles')).toBeNull();
  });

  it('rejects network errors', async () => {
    stubFetch(() => Promise.reject(new Error('black hole')));
    expect(await probeOwnBasemap('https://app.test/tiles')).toBeNull();
  });

  it('validates only the first bytes (512-byte range window)', async () => {
    const bytes = new Uint8Array(512);
    bytes[0] = 0x50;
    bytes[1] = 0x4d;
    let sawRange = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: { headers?: Record<string, string> }) => {
        sawRange = init?.headers?.['Range'] === 'bytes=0-511';
        return new Response(bytes, { status: 206 });
      }),
    );
    await probeOwnBasemap('https://app.test/tiles');
    expect(sawRange).toBe(true); // never fetches the whole archive
  });
});
