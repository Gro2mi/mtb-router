import { describe, expect, it } from 'vitest';
import { SnapIndex } from '../../src/lib/osm/snapIndex';
import type { WaysBundle } from '../../src/lib/osm/overpass';
import { haversineM } from '../../src/lib/osm/geo';

/** Horizontal way along lat 47.0 from lng 8.0 to 8.004 (nodes every ~40 m). */
function bundle(): WaysBundle {
  const nodes = new Map<number, [number, number]>();
  const nodeIds: number[] = [];
  for (let i = 0; i <= 10; i++) {
    const id = 100 + i;
    nodes.set(id, [47.0, 8.0 + i * 0.0004]);
    nodeIds.push(id);
  }
  // parallel singletrail 300 m north, slightly closer to a probe point
  const pathIds: number[] = [];
  for (let i = 0; i <= 5; i++) {
    const id = 200 + i;
    nodes.set(id, [47.0 + 0.0027, 8.0 + i * 0.0008]);
    pathIds.push(id);
  }
  return {
    nodes,
    ways: [
      { id: 1, nodeIds, attrs: { highway: 'track', isSteps: false } },
      { id: 2, nodeIds: pathIds, attrs: { highway: 'path', mtbScale: 2, isSteps: false } },
    ],
  };
}

describe('SnapIndex', () => {
  it('snaps a nearby point onto the closest way segment', () => {
    const index = new SnapIndex(bundle());
    // ~22 m south of the track
    const result = index.snap(8.001, 47.0 - 0.0002, 50);
    expect(result).not.toBeNull();
    expect(result!.wayId).toBe(1);
    expect(result!.lat).toBeCloseTo(47.0, 5);
    expect(result!.lng).toBeCloseTo(8.001, 4);
    expect(result!.distanceM).toBeGreaterThan(15);
    expect(result!.distanceM).toBeLessThan(30);
  });

  it('prefers the nearer of two ways', () => {
    const index = new SnapIndex(bundle());
    // between track (47.0) and path (47.0027): 0.0018 above track ≈ 200 m, ~100 m below path
    const result = index.snap(8.0016, 47.0018, 300);
    expect(result!.wayId).toBe(2);
  });

  it('returns null beyond the snap radius', () => {
    const index = new SnapIndex(bundle());
    expect(index.snap(8.001, 47.0 - 0.0002, 10)).toBeNull(); // ~22 m away, radius 10
    expect(index.snap(7.0, 46.0, 50)).toBeNull();
  });

  it('interpolates the projection between nodes', () => {
    const index = new SnapIndex(bundle());
    // nodes sit every 0.0004° from 8.0000; probe at 8.0006 lies between the
    // nodes at 8.0004 and 8.0008 (segment index 1)
    const result = index.snap(8.0006, 47.0 + 0.00005, 50)!;
    expect(result.wayId).toBe(1);
    expect(result.nodeIndex).toBe(1);
    expect(result.t).toBeGreaterThan(0.4);
    expect(result.t).toBeLessThan(0.6);
    expect(result.lng).toBeCloseTo(8.0006, 5);
  });

  it('reports sane segment/way counts', () => {
    const index = new SnapIndex(bundle());
    expect(index.segmentCount).toBe(15); // 10 track + 5 path segments
    expect(index.wayCount).toBe(2);
  });

  it('snap distance matches haversine ground truth', () => {
    const index = new SnapIndex(bundle());
    const probeLng = 8.0012;
    const probeLat = 47.0 - 0.0003; // ~33 m south of the track
    const result = index.snap(probeLng, probeLat, 100)!;
    const truth = haversineM(probeLng, probeLat, result.lng, result.lat);
    expect(Math.abs(truth - result.distanceM)).toBeLessThan(0.5);
  });
});
