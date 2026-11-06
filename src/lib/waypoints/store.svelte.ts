/**
 * Waypoint model & store (E2.1): ordered list with start/via/end roles,
 * immutable snapshots for undo/redo (E2.7). All mutating operations create a
 * history entry; meta operations (re-snapping) do not.
 */
import type { SnapResult } from '../osm/snapIndex';

export interface Waypoint {
  id: string;
  rawLng: number;
  rawLat: number;
  snap: SnapResult | null;
}

export type WaypointRole = 'start' | 'via' | 'end';

export type SnapFn = (lng: number, lat: number) => SnapResult | null;

const MAX_HISTORY = 100;

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `wp-${Date.now().toString(36)}-${idCounter}`;
}

/** Role by position: first = start, last = end (single waypoint = start). */
export function roleOf(index: number, length: number): WaypointRole | null {
  if (index < 0 || index >= length) return null;
  if (index === 0) return 'start';
  if (index === length - 1) return 'end';
  return 'via';
}

/** Display position of a waypoint (snapped if available, else raw). */
export function displayPosition(wp: Waypoint): [number, number] {
  return wp.snap ? [wp.snap.lng, wp.snap.lat] : [wp.rawLng, wp.rawLat];
}

function sameSnap(a: SnapResult | null, b: SnapResult | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.lng === b.lng &&
    a.lat === b.lat &&
    a.distanceM === b.distanceM &&
    a.wayId === b.wayId &&
    a.nodeIndex === b.nodeIndex &&
    a.t === b.t
  );
}

function cloneList(list: Waypoint[]): Waypoint[] {
  return list.map((wp) => ({ ...wp, snap: wp.snap ? { ...wp.snap } : null }));
}

export class WaypointStore {
  waypoints = $state<Waypoint[]>([]);
  canUndo = $state(false);
  canRedo = $state(false);

  private past: Waypoint[][] = [];
  private future: Waypoint[][] = [];

  private commit(next: Waypoint[]): void {
    this.past.push(cloneList(this.waypoints));
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.waypoints = next;
    this.syncFlags();
  }

  private syncFlags(): void {
    this.canUndo = this.past.length > 0;
    this.canRedo = this.future.length > 0;
  }

  add(lng: number, lat: number): string {
    const wp: Waypoint = { id: newId(), rawLng: lng, rawLat: lat, snap: null };
    this.commit([...cloneList(this.waypoints), wp]);
    return wp.id;
  }

  insertAt(index: number, lng: number, lat: number): string {
    const list = cloneList(this.waypoints);
    const clamped = Math.max(0, Math.min(list.length, index));
    const wp: Waypoint = { id: newId(), rawLng: lng, rawLat: lat, snap: null };
    list.splice(clamped, 0, wp);
    this.commit(list);
    return wp.id;
  }

  move(id: string, lng: number, lat: number): void {
    this.commit(
      cloneList(this.waypoints).map((wp) =>
        wp.id === id ? { ...wp, rawLng: lng, rawLat: lat, snap: null } : wp,
      ),
    );
  }

  remove(id: string): void {
    this.commit(cloneList(this.waypoints).filter((wp) => wp.id !== id));
  }

  removeLast(): void {
    const last = this.waypoints[this.waypoints.length - 1];
    if (last) this.remove(last.id);
  }

  reverse(): void {
    this.commit([...cloneList(this.waypoints)].reverse());
  }

  clear(): void {
    if (this.waypoints.length === 0) return;
    this.commit([]);
  }

  /** Replace the whole list without a history entry (route restore, E6.1). */
  restore(items: Waypoint[]): void {
    this.past = [];
    this.future = [];
    this.waypoints = cloneList(items);
    this.syncFlags();
  }

  /**
   * Re-snap every waypoint against the current index (E2.5). No history
   * entry; skips the write entirely when nothing changed (keeps reactive
   * effects that watch this store from looping).
   */
  resnapAll(snapFn: SnapFn): void {
    let changed = false;
    const next = this.waypoints.map((wp) => {
      const snap = snapFn(wp.rawLng, wp.rawLat);
      if (!sameSnap(wp.snap, snap)) {
        changed = true;
        return { ...wp, snap };
      }
      return wp;
    });
    if (changed) this.waypoints = next;
  }

  /**
   * Apply snaps computed in the engine worker (E3), aligned by index. No
   * history entry; skips identical writes to avoid reactive loops.
   */
  applySnaps(snaps: (SnapResult | null)[]): void {
    if (snaps.length !== this.waypoints.length) return;
    let changed = false;
    const next = this.waypoints.map((wp, i) => {
      const snap = snaps[i] ?? null;
      if (!sameSnap(wp.snap, snap)) {
        changed = true;
        return { ...wp, snap };
      }
      return wp;
    });
    if (changed) this.waypoints = next;
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(cloneList(this.waypoints));
    this.waypoints = prev;
    this.syncFlags();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(cloneList(this.waypoints));
    this.waypoints = next;
    this.syncFlags();
  }
}

export const waypoints = new WaypointStore();
