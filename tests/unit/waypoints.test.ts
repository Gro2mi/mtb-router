import { describe, expect, it } from 'vitest';
import { WaypointStore, roleOf, displayPosition } from '../../src/lib/waypoints/store.svelte';
import type { SnapResult } from '../../src/lib/osm/snapIndex';

const snapAt = (lng: number, lat: number): SnapResult => ({
  lng,
  lat,
  distanceM: 12,
  wayId: 42,
  nodeIndex: 0,
  t: 0.5,
});

function freshIds(store: WaypointStore): string[] {
  return store.waypoints.map((wp) => wp.id);
}

describe('WaypointStore basics', () => {
  it('adds waypoints in order with start/via/end roles', () => {
    const store = new WaypointStore();
    store.add(8.0, 47.0);
    store.add(8.1, 47.1);
    store.add(8.2, 47.2);
    const list = store.waypoints;
    expect(list).toHaveLength(3);
    expect(roleOf(0, 3)).toBe('start');
    expect(roleOf(1, 3)).toBe('via');
    expect(roleOf(2, 3)).toBe('end');
    expect(roleOf(0, 1)).toBe('start'); // single waypoint
    expect(roleOf(5, 3)).toBeNull();
  });

  it('insertAt clamps and preserves order', () => {
    const store = new WaypointStore();
    store.add(8.0, 47.0);
    store.add(8.2, 47.2);
    store.insertAt(1, 8.1, 47.1);
    const l = store.waypoints.map((wp) => wp.rawLng);
    expect(l).toEqual([8.0, 8.1, 8.2]);
    store.insertAt(99, 8.5, 47.5);
    expect(store.waypoints[store.waypoints.length - 1]!.rawLng).toBe(8.5);
  });

  it('move updates raw and clears the stale snap', () => {
    const store = new WaypointStore();
    const id = store.add(8.0, 47.0);
    store.resnapAll(() => snapAt(8.0001, 47.0001));
    expect(store.waypoints[0]!.snap).not.toBeNull();
    store.move(id, 8.3, 47.3);
    expect(store.waypoints[0]!.snap).toBeNull();
    expect(store.waypoints[0]!.rawLng).toBe(8.3);
  });

  it('remove / removeLast / reverse / clear', () => {
    const store = new WaypointStore();
    const a = store.add(8.0, 47.0);
    store.add(8.1, 47.1);
    store.add(8.2, 47.2);
    store.remove(a);
    expect(store.waypoints.map((wp) => wp.rawLng)).toEqual([8.1, 8.2]);
    store.removeLast();
    expect(store.waypoints).toHaveLength(1);
    store.add(8.3, 47.3);
    store.reverse();
    expect(store.waypoints.map((wp) => wp.rawLng)).toEqual([8.3, 8.1]);
    store.clear();
    expect(store.waypoints).toHaveLength(0);
    // clear is undoable (one history entry)…
    store.undo();
    expect(store.waypoints).toHaveLength(2);
    // …and clearing an empty store is a no-op (no second entry)
    store.clear();
    store.clear();
    store.undo();
    expect(store.waypoints).toHaveLength(2);
  });

  it('displayPosition prefers the snapped position', () => {
    const store = new WaypointStore();
    store.add(8.0, 47.0);
    store.resnapAll(() => snapAt(8.0002, 47.0003));
    expect(displayPosition(store.waypoints[0]!)).toEqual([8.0002, 47.0003]);
  });
});

describe('undo/redo', () => {
  it('returns to any prior state exactly', () => {
    const store = new WaypointStore();
    store.add(8.0, 47.0);
    store.add(8.1, 47.1);
    store.add(8.2, 47.2);
    const idsAfter3 = freshIds(store);

    store.undo();
    expect(store.waypoints).toHaveLength(2);
    store.undo();
    expect(store.waypoints).toHaveLength(1);
    store.undo();
    expect(store.waypoints).toHaveLength(0);
    expect(store.canUndo).toBe(false);

    store.redo();
    store.redo();
    store.redo();
    expect(store.waypoints).toHaveLength(3);
    expect(store.waypoints.map((wp) => wp.rawLng)).toEqual([8.0, 8.1, 8.2]);
    // ids are stable across undo/redo (marker identity survives)
    expect(freshIds(store)).toEqual(idsAfter3);
  });

  it('a new action clears the redo stack', () => {
    const store = new WaypointStore();
    store.add(8.0, 47.0);
    store.add(8.1, 47.1);
    store.undo();
    expect(store.canRedo).toBe(true);
    store.add(8.5, 47.5);
    expect(store.canRedo).toBe(false);
    store.redo();
    expect(store.waypoints).toHaveLength(2);
  });

  it('resnapAll does not create history entries', () => {
    const store = new WaypointStore();
    store.add(8.0, 47.0);
    store.add(8.1, 47.1);
    store.resnapAll(() => snapAt(8.0001, 47.0001));
    // history still only contains the two adds: one undo -> the snapshot
    // predates the resnap (snap null), and the stack is exhausted after two
    store.undo();
    expect(store.waypoints).toHaveLength(1);
    expect(store.waypoints[0]!.snap).toBeNull();
    store.undo();
    expect(store.waypoints).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('resnapAll skips the write when nothing changes (no reactive loop)', () => {
    const store = new WaypointStore();
    store.add(8.0, 47.0);
    store.resnapAll(() => snapAt(8.0001, 47.0001));
    const before = store.waypoints;
    store.resnapAll(() => snapAt(8.0001, 47.0001));
    expect(store.waypoints).toBe(before); // identical reference -> no update
  });
});
