import { describe, expect, it } from 'vitest';
import { parseOsmXml, planBoxes } from '../../src/lib/osm/osmApiFallback';
import type { WaysBundle } from '../../src/lib/osm/overpass';

function emptyBundle(): WaysBundle {
  return { nodes: new Map(), ways: [] };
}

describe('planBoxes', () => {
  it('covers a single point with a padded box grid', () => {
    const boxes = planBoxes([[8.0, 47.0]], 0.018); // ~2 km
    expect(boxes.length).toBeGreaterThanOrEqual(4); // 2x2 at max 0.012° edges
    expect(boxes.length).toBeLessThanOrEqual(24);
    const west = Math.min(...boxes.map((b) => b.west));
    const east = Math.max(...boxes.map((b) => b.east));
    const south = Math.min(...boxes.map((b) => b.south));
    const north = Math.max(...boxes.map((b) => b.north));
    expect(west).toBeCloseTo(8.0 - 0.018, 6);
    expect(east).toBeCloseTo(8.0 + 0.018, 6);
    expect(south).toBeCloseTo(47.0 - 0.018, 6);
    expect(north).toBeCloseTo(47.0 + 0.018, 6);
  });

  it('respects the max box edge size', () => {
    const boxes = planBoxes([[8.0, 47.0]], 0.05);
    for (const box of boxes) {
      expect(box.east - box.west).toBeLessThanOrEqual(0.02 + 1e-9);
      expect(box.north - box.south).toBeLessThanOrEqual(0.02 + 1e-9);
    }
  });

  it('covers a polyline segment end to end', () => {
    const boxes = planBoxes(
      [
        [8.0, 47.0],
        [8.06, 47.0],
      ],
      0.005,
    );
    const west = Math.min(...boxes.map((b) => b.west));
    const east = Math.max(...boxes.map((b) => b.east));
    expect(west).toBeCloseTo(7.995, 6);
    expect(east).toBeCloseTo(8.065, 6);
  });

  it('caps the box count on very long corridors', () => {
    const points: [number, number][] = [];
    for (let i = 0; i < 200; i++) points.push([7.0 + i * 0.02, 47.0]);
    expect(planBoxes(points, 0.02).length).toBeLessThanOrEqual(64);
  });
});

describe('parseOsmXml', () => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="OpenStreetMap server">
  <node id="101" lat="47.0" lon="8.0" version="1"/>
  <node id="102" lat="47.0" lon="8.001" version="1"/>
  <node id="103" lat="47.0" lon="8.002" version="1">
    <tag k="foo" v="bar"/>
  </node>
  <node id="201" lat="47.001" lon="8.0"/>
  <node id="202" lat="47.001" lon="8.001"/>
  <way id="1001" version="1">
    <nd ref="101"/>
    <nd ref="102"/>
    <nd ref="103"/>
    <tag k="highway" v="track"/>
    <tag k="surface" v="compacted"/>
  </way>
  <way id="1002">
    <nd ref="201"/>
    <nd ref="202"/>
    <tag k="highway" v="path"/>
    <tag k="mtb:scale" v="2+"/>
    <tag k="note" v="steep &amp; rocky &quot;crux&quot;"/>
  </way>
  <way id="1003">
    <nd ref="201"/>
    <nd ref="202"/>
    <tag k="highway" v="footway"/>
    <tag k="bicycle" v="no"/>
  </way>
  <way id="1004">
    <nd ref="201"/>
    <tag k="highway" v="path"/>
  </way>
  <way id="1005">
    <nd ref="201"/>
    <nd ref="202"/>
    <tag k="name" v="not a highway"/>
  </way>
</osm>`;

  it('parses nodes, routable ways and tags; filters non-routable and degenerate ways', () => {
    const bundle = emptyBundle();
    parseOsmXml(XML, bundle);

    expect(bundle.nodes.size).toBe(5);
    expect(bundle.nodes.get(103)).toEqual([47.0, 8.002]);

    const wayIds = bundle.ways.map((w) => w.id);
    // 1003 bicycle=no footway kept as a WALKING edge (filter v2);
    // 1004 single node, 1005 no highway still dropped
    expect(wayIds).toEqual([1001, 1002, 1003]);

    const track = bundle.ways[0]!;
    expect(track.attrs.highway).toBe('track');
    expect(track.attrs.surface).toBe('compacted');
    expect(track.nodeIds).toEqual([101, 102, 103]);

    const path = bundle.ways[1]!;
    expect(path.attrs.mtbScale).toBe(2.5); // "2+"
  });

  it('parses regardless of attribute order on opening tags', () => {
    const bundle = emptyBundle();
    parseOsmXml(
      `<osm><node lat="47.1" id="301" lon="8.1"/>
       <way version="9" id="3001"><nd ref="301"/><nd ref="302"/><tag k="highway" v="path"/></way>
       <node lon="8.2" lat="47.2" id="302"/></osm>`,
      bundle,
    );
    expect(bundle.nodes.get(301)).toEqual([47.1, 8.1]);
    expect(bundle.nodes.get(302)).toEqual([47.2, 8.2]);
    expect(bundle.ways[0]!.id).toBe(3001);
    expect(bundle.ways[0]!.nodeIds).toEqual([301, 302]);
  });

  it('is idempotent for duplicate ways across boxes', () => {
    const bundle = emptyBundle();
    parseOsmXml(XML, bundle);
    parseOsmXml(XML, bundle);
    expect(bundle.ways.map((w) => w.id)).toEqual([1001, 1002, 1003]);
  });
});
