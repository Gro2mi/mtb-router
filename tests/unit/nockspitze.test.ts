import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOsmXml } from '../../src/lib/osm/osmApiFallback';
import { buildGraph } from '../../src/engine/graph/build';
import { SnapIndex } from '../../src/lib/osm/snapIndex';
import { planRoute } from '../../src/engine/router/route';
import { DEFAULT_SETTINGS } from '../../src/engine/protocol';
import type { WaysBundle } from '../../src/lib/osm/overpass';
import type { SnapResult } from '../../src/lib/osm/snapIndex';

// Real OSM data around Nockspitze summit (api.openstreetmap.org bbox extract)
const xml = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'nockspitze.xml'), 'utf8');

describe('nockspitze summit (real data regression)', () => {
  it('keeps the summit trails and snaps+routes to them', () => {
    const bundle: WaysBundle = { nodes: new Map(), ways: [] };
    parseOsmXml(xml, bundle);
    const trails = bundle.ways.filter((w) => ['path', 'footway'].includes(w.attrs.highway));
    console.log('bundle ways:', bundle.ways.length, '| trails:', trails.length);
    expect(trails.length).toBeGreaterThan(20);

    const graph = buildGraph(bundle);
    const index = new SnapIndex({ nodes: bundle.nodes, ways: graph.keptWays });

    // a point right on the summit plateau trails (Nockspitze ~47.2408, 11.3401)
    const snap1 = index.snap(11.3401, 47.2408, 50);
    const snap2 = index.snap(11.343, 47.2394, 50);
    console.log('summit snap:', JSON.stringify(snap1));
    console.log('second snap:', JSON.stringify(snap2));
    expect(snap1).not.toBeNull();
    expect(snap2).not.toBeNull();

    graph.nodeEle = new Float32Array(graph.nodeCount).fill(2200); // flat-ish proxy
    const snaps: (SnapResult | null)[] = [snap1, snap2];
    const result = planRoute(graph, snaps, DEFAULT_SETTINGS, 2000);
    console.log('route km:', (result.total.distanceM / 1000).toFixed(2));
    expect(result.total.distanceM).toBeGreaterThan(100);
  });
});
