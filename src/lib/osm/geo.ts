/**
 * Minimal local planar projection for snap-distance math (E2.5).
 * Equirectangular around a reference latitude — accurate to well under 1 %
 * at the ≤ 200 m scales snapping works on.
 */
export interface XY {
  x: number;
  y: number;
}

const EARTH_RADIUS = 6_378_137;
const DEG = Math.PI / 180;

export function projectLngLat(lng: number, lat: number, refLat: number): XY {
  return {
    x: lng * Math.cos(refLat * DEG) * DEG * EARTH_RADIUS,
    y: lat * DEG * EARTH_RADIUS,
  };
}

export function metersPerDegLng(refLat: number): number {
  return Math.cos(refLat * DEG) * DEG * EARTH_RADIUS;
}

export const METERS_PER_DEG_LAT = DEG * EARTH_RADIUS;

/** Distance and position of the closest point on segment a→b to p (planar). */
export function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { distanceM: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { distanceM: Math.hypot(px - cx, py - cy), t };
}

export function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLng = (lng2 - lng1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}
