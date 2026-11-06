/**
 * Corridor definition and Overpass query building (E2.3, PLAN §8).
 * A corridor is a buffered polyline through all waypoint positions; its
 * identity is the quantized polyline + radius + schema version and serves as
 * the IndexedDB cache key.
 */
import { haversineM } from './geo';

export const CORRIDOR_SCHEMA_VERSION = 1;
export const DEFAULT_CORRIDOR_RADIUS_M = 2_000;

/** [lng, lat] */
export type CorridorPoint = [number, number];

/** Max polyline points sent to Overpass (keeps queries small on long routes). */
const MAX_QUERY_POINTS = 400;

export function normalizePoints(points: CorridorPoint[]): CorridorPoint[] {
  const out: CorridorPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
    out.push([p[0], p[1]]);
  }
  return out;
}

/** Keep first/last, thin out the middle above MAX_QUERY_POINTS. */
export function decimatePoints(points: CorridorPoint[], max = MAX_QUERY_POINTS): CorridorPoint[] {
  if (points.length <= max) return points;
  const stride = (points.length - 1) / (max - 1);
  const out: CorridorPoint[] = [];
  for (let i = 0; i < max; i++) {
    const src = points[Math.round(i * stride)];
    if (src) out.push([src[0], src[1]]);
  }
  return out;
}

function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

/**
 * Stable cache key for a corridor. The quantized polyline is
 * direction-normalized so reversing a route reuses the same corridor.
 */
export function corridorKey(points: CorridorPoint[], radiusM: number): string {
  const q = points.map(([lng, lat]) => `${lat.toFixed(3)},${lng.toFixed(3)}`);
  const fwd = q.join(';');
  const rev = [...q].reverse().join(';');
  const canonical = fwd <= rev ? fwd : rev;
  return djb2Hex(`v${CORRIDOR_SCHEMA_VERSION}|r${Math.round(radiusM)}|${canonical}`);
}

/** Stage 1: trails/tracks. Stage 2: connecting roads + conditionally-routable ways. */
const HIGHWAY_FILTERS: readonly [string, string] = [
  '^(track|path|cycleway|bridleway)$',
  '^(service|unclassified|residential|living_street|tertiary|secondary|pedestrian|footway|steps)$',
];

export function buildStageQueries(points: CorridorPoint[], radiusM: number): [string, string] {
  const coords = points.map(([lng, lat]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join(',');
  return HIGHWAY_FILTERS.map(
    (filter) =>
      `[out:json][timeout:90];\n` +
      `(\n  way["highway"~"${filter}"](around:${Math.round(radiusM)},${coords});\n);\n` +
      `(._;>;);\n` +
      `out body;`,
  ) as [string, string];
}

/** Corridor length in meters along the polyline (diagnostics/tests). */
export function corridorLengthM(points: CorridorPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += haversineM(a[0], a[1], b[0], b[1]);
  }
  return total;
}
