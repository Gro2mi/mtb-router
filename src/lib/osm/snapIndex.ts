/**
 * Snapping (E2.5, PLAN §10): uniform-grid spatial index over way segments and
 * nearest-segment projection within a snap radius. Pure module.
 */
import { METERS_PER_DEG_LAT, metersPerDegLng, pointSegmentDistance, projectLngLat } from './geo';
import type { WaysBundle } from './overpass';

const CELL_SIZE_M = 100;

export interface SnapResult {
  lng: number;
  lat: number;
  /** distance from the query point to the way in meters */
  distanceM: number;
  wayId: number;
  /** index of the node the projection follows (projection lies between nodeIndex and +1) */
  nodeIndex: number;
  /** position along that segment, 0..1 */
  t: number;
}

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  aLng: number;
  aLat: number;
  bLng: number;
  bLat: number;
  wayId: number;
  nodeIndex: number;
}

export class SnapIndex {
  private readonly segments: Segment[] = [];
  private readonly grid = new Map<string, number[]>();
  private readonly refLat: number;
  private readonly mPerLng: number;

  constructor(bundle: WaysBundle) {
    let latSum = 0;
    let latCount = 0;
    for (const [, [lat]] of bundle.nodes) {
      latSum += lat;
      latCount++;
    }
    this.refLat = latCount > 0 ? latSum / latCount : 0;
    this.mPerLng = metersPerDegLng(this.refLat);

    for (const way of bundle.ways) {
      for (let i = 0; i + 1 < way.nodeIds.length; i++) {
        const aId = way.nodeIds[i]!;
        const bId = way.nodeIds[i + 1]!;
        const a = bundle.nodes.get(aId);
        const b = bundle.nodes.get(bId);
        if (!a || !b) continue;
        const aXY = projectLngLat(a[1], a[0], this.refLat);
        const bXY = projectLngLat(b[1], b[0], this.refLat);
        const segment: Segment = {
          ax: aXY.x,
          ay: aXY.y,
          bx: bXY.x,
          by: bXY.y,
          aLng: a[1],
          aLat: a[0],
          bLng: b[1],
          bLat: b[0],
          wayId: way.id,
          nodeIndex: i,
        };
        const index = this.segments.push(segment) - 1;
        this.insertIntoGrid(segment, index);
      }
    }
  }

  get segmentCount(): number {
    return this.segments.length;
  }

  get wayCount(): number {
    return new Set(this.segments.map((s) => s.wayId)).size;
  }

  private cellKey(ix: number, iy: number): string {
    return `${ix}:${iy}`;
  }

  private insertIntoGrid(segment: Segment, index: number): void {
    const ix0 = Math.floor(Math.min(segment.ax, segment.bx) / CELL_SIZE_M);
    const ix1 = Math.floor(Math.max(segment.ax, segment.bx) / CELL_SIZE_M);
    const iy0 = Math.floor(Math.min(segment.ay, segment.by) / CELL_SIZE_M);
    const iy1 = Math.floor(Math.max(segment.ay, segment.by) / CELL_SIZE_M);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const key = this.cellKey(ix, iy);
        let bucket = this.grid.get(key);
        if (!bucket) {
          bucket = [];
          this.grid.set(key, bucket);
        }
        bucket.push(index);
      }
    }
  }

  /** Nearest routable way within `radiusM`, or null (PLAN §10). */
  snap(lng: number, lat: number, radiusM: number): SnapResult | null {
    const p = projectLngLat(lng, lat, this.refLat);
    const range = Math.ceil(radiusM / CELL_SIZE_M);
    const cx = Math.floor(p.x / CELL_SIZE_M);
    const cy = Math.floor(p.y / CELL_SIZE_M);

    const candidates = new Set<number>();
    for (let ix = cx - range; ix <= cx + range; ix++) {
      for (let iy = cy - range; iy <= cy + range; iy++) {
        const bucket = this.grid.get(this.cellKey(ix, iy));
        if (bucket) for (const index of bucket) candidates.add(index);
      }
    }
    if (candidates.size === 0) return null;

    let best: { segment: Segment; distanceM: number; t: number } | null = null;
    for (const index of candidates) {
      const segment = this.segments[index]!;
      const { distanceM, t } = pointSegmentDistance(
        p.x,
        p.y,
        segment.ax,
        segment.ay,
        segment.bx,
        segment.by,
      );
      if (!best || distanceM < best.distanceM) best = { segment, distanceM, t };
    }
    if (!best || best.distanceM > radiusM) return null;
    const s = best.segment;
    return {
      lng: s.aLng + (s.bLng - s.aLng) * best.t,
      lat: s.aLat + (s.bLat - s.aLat) * best.t,
      distanceM: best.distanceM,
      wayId: s.wayId,
      nodeIndex: s.nodeIndex,
      t: best.t,
    };
  }
}

/** Re-exported for callers that need meter scales alongside the index. */
export { METERS_PER_DEG_LAT, metersPerDegLng };
