import { describe, expect, it } from 'vitest';
import { buildGraph, onewayDirection } from '../../src/engine/graph/build';
import type { WaysBundle } from '../../src/lib/osm/overpass';

function bundleFrom(
  nodes: [number, number, number][], // id, lat, lng
  ways: { id: number; nodes: number[]; tags?: Record<string, string> }[],
): WaysBundle {
  const map = new Map<number, [number, number]>();
  for (const [id, lat, lng] of nodes) map.set(id, [lat, lng]);
  return {
    nodes: map,
    ways: ways.map((w) => ({
      id: w.id,
      nodeIds: w.nodes,
      attrs: {
        highway: w.tags?.['highway'] ?? 'track',
        surface: w.tags?.['surface'],
        tracktype: w.tags?.['tracktype'],
        sacScale: w.tags?.['sac_scale'],
        bicycle: w.tags?.['bicycle'],
        oneway: w.tags?.['oneway'],
        onewayBicycle: w.tags?.['oneway:bicycle'],
        isSteps: w.tags?.['highway'] === 'steps',
      },
    })),
  };
}

/** outgoing neighbor indices of graph node index i */
function outs(g: ReturnType<typeof buildGraph>, i: number): number[] {
  return [...g.targets.slice(g.offsets[i]!, g.offsets[i + 1]!)];
}

describe('onewayDirection', () => {
  it('respects oneway=yes on roads', () => {
    const b = bundleFrom(
      [[1, 0, 0]],
      [{ id: 1, nodes: [1], tags: { highway: 'residential', oneway: 'yes' } }],
    );
    expect(onewayDirection(b.ways[0]!.attrs)).toBe(1);
  });

  it('oneway:bicycle=no exempts bikes from a road oneway', () => {
    const b = bundleFrom(
      [[1, 0, 0]],
      [
        {
          id: 1,
          nodes: [1],
          tags: { highway: 'residential', oneway: 'yes', 'oneway:bicycle': 'no' },
        },
      ],
    );
    expect(onewayDirection(b.ways[0]!.attrs)).toBe(0);
  });

  it('oneway cycleways are directed', () => {
    const b = bundleFrom(
      [[1, 0, 0]],
      [{ id: 1, nodes: [1], tags: { highway: 'cycleway', oneway: 'yes' } }],
    );
    expect(onewayDirection(b.ways[0]!.attrs)).toBe(1);
  });

  it('trails ignore car oneway', () => {
    const b = bundleFrom(
      [[1, 0, 0]],
      [{ id: 1, nodes: [1], tags: { highway: 'path', oneway: 'yes' } }],
    );
    expect(onewayDirection(b.ways[0]!.attrs)).toBe(0);
  });
});

describe('buildGraph', () => {
  const nodes: [number, number, number][] = [
    [1, 47.0, 8.0], // index 0
    [2, 47.0, 8.001], // index 1
    [3, 47.0, 8.002], // index 2
    [4, 47.001, 8.001], // index 3
    [5, 48.0, 9.0], // index 4 — isolated component
    [6, 48.0, 9.001], // index 5
  ];

  it('builds CSR with both directions and correct segment lookup', () => {
    const b = bundleFrom(nodes, [
      { id: 10, nodes: [1, 2, 3] },
      { id: 20, nodes: [2, 4] },
    ]);
    const g = buildGraph(b);
    expect(g.nodeCount).toBe(6);
    expect(g.segments).toHaveLength(3);

    // node id 1 (index 0) → only neighbor id 2 (index 1)
    expect(outs(g, 0)).toEqual([1]);
    // node id 2 (index 1) → neighbors ids 1, 3, 4 (indices 0, 2, 3)
    expect(outs(g, 1).sort((a, b2) => a - b2)).toEqual([0, 2, 3]);

    // waySegIdx maps way ids to segment indices
    expect(g.waySegIdx.get(10)).toEqual([0, 1]);
    expect(g.waySegIdx.get(20)).toEqual([2]);
    expect(g.wayIds[g.segments[0]!.wayIdx]).toBe(10);
  });

  it('drops small disconnected components', () => {
    const b = bundleFrom(nodes, [
      { id: 10, nodes: [1, 2, 3] },
      { id: 99, nodes: [5, 6] }, // isolated pair — must be dropped
    ]);
    const g = buildGraph(b);
    expect(g.segments).toHaveLength(2);
    expect(g.keptWays.map((w) => w.id)).toEqual([10]);
    expect(g.waySegIdx.has(99)).toBe(false);
  });

  it('oneway=yes yields a single directed edge', () => {
    const b = bundleFrom(
      [
        [1, 47.0, 8.0],
        [2, 47.0, 8.001],
      ],
      [{ id: 10, nodes: [1, 2], tags: { highway: 'residential', oneway: 'yes' } }],
    );
    const g = buildGraph(b);
    expect(outs(g, 0)).toEqual([1]); // id 1 → id 2
    expect(outs(g, 1)).toEqual([]); // no way back
    // the surviving edge travels with geometry (not reversed)
    expect(g.rev[g.offsets[0]!]).toBe(0);
  });

  it('oneway=-1 yields only the reverse edge', () => {
    const b = bundleFrom(
      [
        [1, 47.0, 8.0],
        [2, 47.0, 8.001],
      ],
      [{ id: 10, nodes: [1, 2], tags: { highway: 'residential', oneway: '-1' } }],
    );
    const g = buildGraph(b);
    expect(outs(g, 0)).toEqual([]);
    expect(outs(g, 1)).toEqual([0]); // id 2 → id 1, against geometry
    expect(g.rev[g.offsets[1]!]).toBe(1);
  });

  it('keeps ways whole in keptWays for the snap index', () => {
    const b = bundleFrom(nodes, [{ id: 10, nodes: [1, 2, 3] }]);
    const g = buildGraph(b);
    expect(g.keptWays).toHaveLength(1);
    expect(g.keptWays[0]!.nodeIds).toEqual([1, 2, 3]);
  });
});
