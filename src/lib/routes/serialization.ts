/**
 * Route persistence (E6.1): serialization between the live reactive stores
 * and the plain StoredRoute record. Pure module — unit-testable round-trips.
 */
import type { SnapResult } from '../osm/snapIndex';
import type { Viewport } from '../state/viewport';
import type { RouteResult, RiderSettings } from '../../engine/protocol';
import type { Waypoint } from '../waypoints/store.svelte';

/** Plain, structured-cloneable record persisted in the IDB `routes` store. */
export interface StoredRoute {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** raw tap positions + the snaps they resolved to (display positions) */
  waypoints: { rawLng: number; rawLat: number; snap: SnapResult | null }[];
  settings: RiderSettings;
  route: RouteResult | null;
  viewport: Viewport | null;
  /** engine protocol version that produced `route` (future migrations) */
  schemaVersion: number;
}

export const ROUTE_SCHEMA_VERSION = 1;

export function toStoredRoute(input: {
  id: string;
  name: string;
  waypoints: Waypoint[];
  settings: RiderSettings;
  route: RouteResult | null;
  viewport: Viewport | null;
  createdAt?: number;
}): StoredRoute {
  const now = Date.now();
  return {
    id: input.id,
    name: input.name,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    waypoints: input.waypoints.map((wp) => ({
      rawLng: wp.rawLng,
      rawLat: wp.rawLat,
      snap: wp.snap ? { ...wp.snap } : null,
    })),
    settings: structuredClone(input.settings),
    route: input.route ? structuredClone(input.route) : null,
    viewport: input.viewport ? { ...input.viewport } : null,
    schemaVersion: ROUTE_SCHEMA_VERSION,
  };
}

/** Rebuild live waypoint objects (without history entries) from a record. */
export function storedToWaypoints(stored: StoredRoute): Waypoint[] {
  return stored.waypoints.map((wp) => ({
    id: `${stored.id}-${wp.rawLng.toFixed(6)}-${wp.rawLat.toFixed(6)}`,
    rawLng: wp.rawLng,
    rawLat: wp.rawLat,
    snap: wp.snap ? { ...wp.snap } : null,
  }));
}

/** Deep-equality of the geometry-relevant parts (round-trip assertion helper). */
export function sameGeometry(a: StoredRoute, b: StoredRoute): boolean {
  return (
    JSON.stringify(a.waypoints.map(displayCoord)) ===
      JSON.stringify(b.waypoints.map(displayCoord)) &&
    JSON.stringify(a.route) === JSON.stringify(b.route) &&
    JSON.stringify(a.settings) === JSON.stringify(b.settings)
  );
}

function displayCoord(wp: {
  rawLng: number;
  rawLat: number;
  snap: SnapResult | null;
}): [number, number] {
  return wp.snap ? [wp.snap.lng, wp.snap.lat] : [wp.rawLng, wp.rawLat];
}

/** Filesystem/web-safe GPX file basename. */
export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[\p{M}]+/gu, '') // strip combining marks (Ä → A)
    .replaceAll(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'route' : slug.slice(0, 60);
}
