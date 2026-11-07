import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCorridor, resetOverpassState } from '../../src/lib/osm/overpass';
import type { CorridorPoint } from '../../src/lib/osm/corridor';

const points: CorridorPoint[] = [[8.002, 47.0002]];
const MIRROR_HOSTS = ['overpass-api.de', 'overpass.kumi.systems', 'overpass.private.coffee'];

const osmXml = `<?xml version="1.0"?><osm>
  <node id="1" lat="47.0" lon="8.0"/><node id="2" lat="47.0" lon="8.001"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="track"/></way>
</osm>`;

const overpassJson = JSON.stringify({
  elements: [
    { type: 'node', id: 1, lat: 47.0, lon: 8.0 },
    { type: 'node', id: 2, lat: 47.0, lon: 8.001 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'track' } },
  ],
});

const fetchCalls: string[] = [];

function mockFetch(behavior: {
  mirrors: 'reject' | 'first-ok' | 'hang';
  osmApi?: 'ok' | 'reject';
}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: { body?: string; signal?: AbortSignal }) => {
      const href = String(url);
      const body =
        typeof (init as { body?: string } | undefined)?.body === 'string'
          ? (init as { body: string }).body
          : '';
      const isStage1 = body.includes('track|path|cycleway|bridleway');
      fetchCalls.push(href);
      if (href.includes('/api/interpreter')) {
        if (behavior.mirrors === 'reject') {
          return Promise.reject(new Error('connection refused'));
        }
        if (behavior.mirrors === 'hang') {
          // black hole that still honors the abort signal (like real fetch)
          return new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
        }
        // first-ok: the first mirror host rejects, the second answers
        if (href.includes(MIRROR_HOSTS[0]!)) {
          return Promise.reject(new Error('connection refused'));
        }
        return new Response(isStage1 ? overpassJson : JSON.stringify({ elements: [] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (href.includes('api.openstreetmap.org')) {
        if (behavior.osmApi === 'reject') return Promise.reject(new Error('osm api down'));
        return new Response(osmXml, { headers: { 'Content-Type': 'text/xml' } });
      }
      return new Response('unmocked', { status: 404 });
    }),
  );
}

describe('Overpass mirror race + cooldown (speed fix)', () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    resetOverpassState();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('races mirrors: a failing first mirror does not delay the answering one', async () => {
    mockFetch({ mirrors: 'first-ok' });
    const bundle = await fetchCorridor(points, 2000);
    expect(bundle.ways.map((w) => w.id)).toEqual([10]);
    // no OSM API fallback traffic — Overpass answered
    expect(fetchCalls.some((c) => c.includes('api.openstreetmap.org'))).toBe(false);
  });

  it('black-holed mirrors: corridor comes from the OSM API after one timeout window', async () => {
    mockFetch({ mirrors: 'hang', osmApi: 'ok' });
    const promise = fetchCorridor(points, 2000);
    // advance past the stage-1 (15 s) and stage-2 (45 s) timeout windows
    await vi.advanceTimersByTimeAsync(70_000);
    const bundle = await promise;
    expect(bundle.ways.map((w) => w.id)).toEqual([10]);
  });

  it(
    'cooldown: after a total failure the next corridor skips Overpass entirely',
    { timeout: 20_000 },
    async () => {
      mockFetch({ mirrors: 'reject', osmApi: 'ok' });

      await fetchCorridor(points, 2000);
      const mirrorCallsAfterFirst = fetchCalls.filter((c) => c.includes('/api/interpreter')).length;
      expect(mirrorCallsAfterFirst).toBeGreaterThan(0); // it did try the mirrors

      fetchCalls.length = 0;
      await fetchCorridor(points, 2000);
      // cooldown active: zero mirror requests, straight to the OSM API
      expect(fetchCalls.filter((c) => c.includes('/api/interpreter'))).toHaveLength(0);
      expect(fetchCalls.some((c) => c.includes('api.openstreetmap.org'))).toBe(true);
    },
  );

  it('cooldown expires and mirrors are tried again', { timeout: 20_000 }, async () => {
    mockFetch({ mirrors: 'reject', osmApi: 'ok' });
    await fetchCorridor(points, 2000); // sets the global cooldown

    fetchCalls.length = 0;
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000); // cooldown expires
    await fetchCorridor(points, 2000);
    expect(fetchCalls.filter((c) => c.includes('/api/interpreter')).length).toBeGreaterThan(0);
  });

  it('both sources failing surfaces the corridor error', async () => {
    mockFetch({ mirrors: 'reject', osmApi: 'reject' });
    await expect(fetchCorridor(points, 2000)).rejects.toThrow();
  });
});
