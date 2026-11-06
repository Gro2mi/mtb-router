import { describe, expect, it } from 'vitest';
import {
  sameGeometry,
  slugifyName,
  storedToWaypoints,
  toStoredRoute,
  type StoredRoute,
} from '../../src/lib/routes/serialization';
import { MemoryRouteKv } from '../../src/lib/routes/routeStore';
import type { RouteResult, RiderSettings } from '../../src/engine/protocol';
import type { Waypoint } from '../../src/lib/waypoints/store.svelte';

const settings: RiderSettings = {
  uphill: { mtb: { min: 0, max: 2 }, sac: { min: 1, max: 3 } },
  downhill: { mtb: { min: 0, max: 3 }, sac: { min: 1, max: 4 } },
  forestRoadPreference: 0.5,
  avoidUntaggedSingletrail: false,
};

const route: RouteResult = {
  legs: [
    {
      segments: [
        {
          wayId: 7,
          highway: 'track',
          mtbDown: 0,
          mtbUp: 0,
          sac: 1,
          difficultyTagged: false,
          coords: [
            [47.0, 8.0, 500],
            [47.001, 8.001, 502],
          ],
          distanceM: 130,
          ascentM: 2,
          descentM: 0,
          timeS: 40,
        },
      ],
      distanceM: 130,
      ascentM: 2,
      descentM: 0,
      timeS: 40,
    },
  ],
  total: { distanceM: 130, ascentM: 2, descentM: 0, timeS: 40 },
  kmByMtb: [0.1, 0, 0, 0, 0, 0, 0],
  radiusM: 2000,
  elevationAvailable: true,
};

const waypoints: Waypoint[] = [
  {
    id: 'a',
    rawLng: 8.0,
    rawLat: 47.0,
    snap: { lng: 8.0, lat: 47.0, distanceM: 1, wayId: 7, nodeIndex: 0, t: 0 },
  },
  { id: 'b', rawLng: 8.0011, rawLat: 47.0011, snap: null },
];

const viewport = { center: [8.0, 47.0] as [number, number], zoom: 13, bearing: 10, pitch: 0 };

describe('route serialization (E6.1)', () => {
  it('round-trips toStoredRoute → storedToWaypoints preserving geometry', () => {
    const stored = toStoredRoute({
      id: 'r1',
      name: 'Test route',
      waypoints,
      settings,
      route,
      viewport,
    });
    expect(stored.schemaVersion).toBe(1);
    expect(stored.createdAt).toBe(stored.updatedAt);

    const restored = storedToWaypoints(stored);
    expect(restored).toHaveLength(2);
    // raw positions preserved
    expect(restored[0]!.rawLng).toBe(8.0);
    expect(restored[1]!.rawLng).toBe(8.0011);
    // snap data preserved
    expect(restored[0]!.snap?.wayId).toBe(7);
    expect(restored[1]!.snap).toBeNull();
    // ids are derived deterministically (stable across reloads)
    expect(restored[0]!.id).toBe('r1-8.000000-47.000000');
  });

  it('detects identical geometry via sameGeometry', () => {
    const a = toStoredRoute({ id: 'a', name: 'A', waypoints, settings, route, viewport });
    const b = toStoredRoute({ id: 'b', name: 'B', waypoints, settings, route, viewport });
    expect(sameGeometry(a, b)).toBe(true); // different names/ids, same geometry
    const altered = toStoredRoute({
      id: 'c',
      name: 'C',
      waypoints: waypoints.map((wp) => ({ ...wp, rawLat: wp.rawLat + 0.01 })),
      settings,
      route,
      viewport,
    });
    expect(sameGeometry(a, altered)).toBe(false);
  });

  it('deep-clones: mutating the record does not touch the live stores', () => {
    const stored = toStoredRoute({ id: 'r', name: 'R', waypoints, settings, route, viewport });
    stored.route!.total.distanceM = 99999;
    stored.waypoints[0]!.snap!.wayId = 1;
    expect(route.total.distanceM).toBe(130);
    expect(waypoints[0]!.snap!.wayId).toBe(7);
  });

  it('slugifies names for files', () => {
    expect(slugifyName('Alpen Überfahrt 2026!')).toBe('alpen-uberfahrt-2026');
    expect(slugifyName('///')).toBe('route');
  });
});

describe('route store CRUD (MemoryRouteKv)', () => {
  it('put/get/list/delete/duplicate round-trip', async () => {
    const kv = new MemoryRouteKv();
    const a = toStoredRoute({ id: 'a', name: 'A', waypoints, settings, route, viewport });
    const b = toStoredRoute({
      id: 'b',
      name: 'B',
      waypoints,
      settings,
      route: null,
      viewport: null,
    });
    await kv.put(a);
    await kv.put(b);

    const all = await kv.getAll();
    expect(all.map((r: StoredRoute) => r.id).sort()).toEqual(['a', 'b']);

    expect((await kv.get('a'))?.name).toBe('A');

    // duplicate creates a copy with a new id
    const dup = await (async () => {
      const original = await kv.get('a');
      if (!original) throw new Error('missing');
      const copy: StoredRoute = { ...structuredClone(original), id: 'a-copy', name: 'A (2)' };
      await kv.put(copy);
      return copy;
    })();
    expect(dup.name).toBe('A (2)');
    expect((await kv.getAll()).length).toBe(3);

    await kv.delete('b');
    expect((await kv.getAll()).map((r) => r.id).sort()).toEqual(['a', 'a-copy']);
  });

  it('updates in place on put with the same id (rename)', async () => {
    const kv = new MemoryRouteKv();
    const a = toStoredRoute({ id: 'a', name: 'Old', waypoints, settings, route, viewport });
    await kv.put(a);
    await kv.put({ ...a, name: 'New', updatedAt: a.updatedAt + 1000 });
    expect(await kv.getAll().then((all) => all.length)).toBe(1);
    expect((await kv.get('a'))?.name).toBe('New');
  });
});
