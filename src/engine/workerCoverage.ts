/**
 * Coverage test for graph reuse (see worker.ts): a plan reuses the built
 * graph only when its ENTIRE corridor region fits inside the loaded region —
 * waypoints alone are not enough, because a waypoint near the edge can snap
 * onto a trail whose junctions lie outside the built graph (disconnected
 * component → the leg degrades into a beeline).
 */

export interface Region {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface LoadInfo {
  /** bbox of the load's waypoints, already expanded by its radius */
  region: Region;
  /** the radius the region was expanded with */
  radiusM: number;
}

const M_PER_DEG_LAT = 111_320;

function degSize(radiusM: number, meanLat: number): { dLat: number; dLng: number } {
  return {
    dLat: radiusM / M_PER_DEG_LAT,
    dLng: radiusM / (M_PER_DEG_LAT * Math.max(0.1, Math.cos((meanLat * Math.PI) / 180))),
  };
}

/** bbox of the waypoints, expanded by radiusM (matches the tile-range math) */
export function regionFor(points: [number, number][], radiusM: number): Region {
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const meanLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const { dLat, dLng } = degSize(radiusM, meanLat);
  return {
    minLng: Math.min(...lngs) - dLng,
    maxLng: Math.max(...lngs) + dLng,
    minLat: Math.min(...lats) - dLat,
    maxLat: Math.max(...lats) + dLat,
  };
}

/** is the new plan's whole corridor region inside the loaded region? */
export function regionCovers(loaded: LoadInfo, points: [number, number][], radiusM: number): boolean {
  if (radiusM > loaded.radiusM) return false;
  // regionFor is already ring-expanded (bbox ⊕ radius) — plain containment
  const r = regionFor(points, radiusM);
  return (
    r.minLng >= loaded.region.minLng &&
    r.maxLng <= loaded.region.maxLng &&
    r.minLat >= loaded.region.minLat &&
    r.maxLat <= loaded.region.maxLat
  );
}
