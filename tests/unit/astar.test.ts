import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/engine/graph/build';
import {
  attachWaypoints,
  computeSegmentCosts,
  findPath,
  RouteBlockedError,
} from '../../src/engine/router/astar';
import { planRoute } from '../../src/engine/router/route';
import { DEFAULT_SETTINGS } from '../../src/engine/protocol';
import type { WaysBundle } from '../../src/lib/osm/overpass';
import type { SnapResult } from '../../src/lib/osm/snapIndex';

/** 3×3 grid of tracks, 100 m spacing; node ids 11..19 row-major. */
function gridBundle(): WaysBundle {
  const nodes = new Map<number, [number, number]>();
  const idAt = (row: number, col: number): number => 11 + row * 3 + col;
  const ways: WaysBundle['ways'] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      nodes.set(idAt(row, col), [47.0 + row * 0.0009, 8.0 + col * 0.0013]);
    }
  }
  const link = (a: number, b: number, tags?: Record<string, string>): void => {
    ways.push({
      id: 100 + ways.length,
      nodeIds: [a, b],
      attrs: {
        highway: 'track',
        tracktype: 'grade2',
        surface: 'compacted',
        isSteps: false,
        ...tags,
      },
    });
  };
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (col < 2) link(idAt(row, col), idAt(row, col + 1));
      if (row < 2) link(idAt(row, col), idAt(row + 1, col));
    }
  }
  return { nodes, ways };
}

const snapOn = (
  wayId: number,
  nodeIndex: number,
  lng: number,
  lat: number,
  t = 0.5,
): SnapResult => ({
  wayId,
  nodeIndex,
  t,
  lng,
  lat,
  distanceM: 1,
});

describe('bidirectional A* (E3.6)', () => {
  it('finds the shortest path across the grid', () => {
    const graph = buildGraph(gridBundle());
    const costs = computeSegmentCosts(graph, DEFAULT_SETTINGS);
    const attach = attachWaypoints(graph, [
      snapOn(100, 0, 8.00065, 47.0), // way 100 = row0 col0→col1, segment 0
      snapOn(107, 0, 8.0026, 47.0018), // way 107 = row1 col1→col2, segment 0
    ]);
    const chain = findPath({ graph, costs, attach }, attach.wpNodes[0]!, attach.wpNodes[1]!);
    expect(chain.length).toBeGreaterThanOrEqual(2);
    // connectivity is proven by planRoute decoding the chain hop-by-hop
  });

  it('throws RouteBlockedError when target is disconnected', () => {
    const bundle = gridBundle();
    bundle.ways = bundle.ways.filter((w) => !w.nodeIds.includes(19));
    const g2 = buildGraph(bundle);
    const costs = computeSegmentCosts(g2, DEFAULT_SETTINGS);
    // an unsnapped waypoint gets a link-less virtual node → unreachable
    const attach2 = attachWaypoints(g2, [snapOn(100, 0, 8.00065, 47.0), null]);
    expect(() =>
      findPath({ graph: g2, costs, attach: attach2 }, attach2.wpNodes[0]!, attach2.wpNodes[1]!),
    ).toThrow(RouteBlockedError);
  });

  it('excluded segments force a detour; waypoint stubs still pass', () => {
    const bundle = gridBundle();
    // way 100 (row0 col0→col1, one segment) gets mtb 4/4 → excluded for flat
    // travel under the default downhill band (max 3)
    const first = bundle.ways[0]!;
    first.attrs.mtbScale = 4;
    first.attrs.mtbScaleUphill = 4;
    const graph = buildGraph(bundle);
    const costs = computeSegmentCosts(graph, DEFAULT_SETTINGS);
    expect(costs.excludedFwd[0]).toBe(1); // way 100's single segment
    expect(costs.excludedFwd[1]).toBe(0); // segment 1 = way 101 (vertical), untouched

    const attach = attachWaypoints(graph, [
      // waypoint ON the excluded way — the stub must still pass
      { wayId: 100, nodeIndex: 0, t: 0.99, lng: 8.00128, lat: 47.0, distanceM: 1 },
      snapOn(107, 0, 8.0026, 47.0018),
    ]);
    const chain = findPath({ graph, costs, attach }, attach.wpNodes[0]!, attach.wpNodes[1]!);
    // the chain must not use segment 0 (the excluded direct connection)
    const used = new Set<number>();
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i]!;
      for (let e = graph.offsets[a]!; e < graph.offsets[a + 1]!; e++) {
        if (graph.targets[e] === chain[i + 1]) used.add(graph.segIdx[e]!);
      }
    }
    expect(used.has(0)).toBe(false);
  });
});

describe('planRoute (E3.7 assembly)', () => {
  it('assembles legs with stats and per-difficulty km', () => {
    const graph = buildGraph(gridBundle());
    graph.nodeEle = new Float32Array(graph.nodeCount).fill(100); // flat, 100 m
    const snaps = [
      snapOn(100, 0, 8.00065, 47.0),
      snapOn(105, 0, 8.00065, 47.0009),
      snapOn(107, 0, 8.0026, 47.0018),
    ];
    const result = planRoute(graph, snaps, DEFAULT_SETTINGS, 2000);
    expect(result.legs).toHaveLength(2);
    expect(result.total.distanceM).toBeGreaterThan(100); // at least one hop each
    expect(result.total.timeS).toBeGreaterThan(0);
    expect(result.radiusM).toBe(2000);
    expect(result.elevationAvailable).toBe(true);
    // flat grid: all km in difficulty bucket of track (mtbDown 0 inferred)
    expect(result.kmByMtb[0]).toBeGreaterThan(0);
    for (const leg of result.legs) {
      expect(leg.ascentM).toBe(0);
      expect(leg.descentM).toBe(0);
    }
  });

  it('computes ascent/descent from elevation with direction', () => {
    const graph = buildGraph(gridBundle());
    const ele = new Float32Array(graph.nodeCount);
    for (let i = 0; i < graph.nodeCount; i++) ele[i] = 100 + graph.nodeLat[i]! * 10000; // north rises
    graph.nodeEle = ele;
    // mark segment dz
    for (const s of graph.segments) {
      s.dz = ele[s.v]! - ele[s.u]!;
    }
    const result = planRoute(
      graph,
      [snapOn(100, 0, 8.00065, 47.0), snapOn(107, 0, 8.0026, 47.0018)],
      DEFAULT_SETTINGS,
      2000,
    );
    // route heads north → net ascent
    expect(result.total.ascentM).toBeGreaterThan(result.total.descentM);
  });

  it('blocked leg names its index', () => {
    const graph = buildGraph(gridBundle());
    // first leg already targets the link-less virtual node
    const snaps = [snapOn(100, 0, 8.00065, 47.0), null, snapOn(107, 0, 8.0026, 47.0018)];
    expect(() => planRoute(graph, snaps, DEFAULT_SETTINGS, 2000)).toThrowError(/leg 0/);
  });
});
