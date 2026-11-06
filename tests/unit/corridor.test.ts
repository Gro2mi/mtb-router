import { describe, expect, it } from 'vitest';
import {
  buildStageQueries,
  corridorKey,
  decimatePoints,
  normalizePoints,
  type CorridorPoint,
} from '../../src/lib/osm/corridor';

const p = (lng: number, lat: number): CorridorPoint => [lng, lat];

describe('normalizePoints', () => {
  it('drops consecutive duplicates', () => {
    const pts = [p(1, 1), p(1, 1), p(2, 2), p(2, 2)];
    expect(normalizePoints(pts)).toEqual([p(1, 1), p(2, 2)]);
  });

  it('keeps distinct close points', () => {
    const pts = [p(1.0000001, 1), p(1.00001, 1)];
    expect(normalizePoints(pts)).toHaveLength(2);
  });
});

describe('decimatePoints', () => {
  it('keeps short polylines untouched', () => {
    const pts = [p(0, 0), p(1, 1)];
    expect(decimatePoints(pts)).toEqual(pts);
  });

  it('caps the point count and keeps first and last', () => {
    const pts: CorridorPoint[] = [];
    for (let i = 0; i < 1000; i++) pts.push(p(i * 0.001, 47));
    const out = decimatePoints(pts, 100);
    expect(out).toHaveLength(100);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });
});

describe('corridorKey', () => {
  it('is stable for identical inputs', () => {
    const pts = [p(8.123456, 47.654321), p(8.5, 47.9)];
    expect(corridorKey(pts, 2000)).toBe(corridorKey([p(8.123456, 47.654321), p(8.5, 47.9)], 2000));
  });

  it('quantizes: small moves below grid resolution keep the key', () => {
    const a = corridorKey([p(8.00001, 47.00001)], 2000);
    const b = corridorKey([p(8.00012, 47.00014)], 2000);
    expect(a).toBe(b);
  });

  it('direction-normalized: reversed routes reuse the corridor', () => {
    const pts = [p(8.1, 47.1), p(8.2, 47.2), p(8.3, 47.3)];
    expect(corridorKey(pts, 2000)).toBe(corridorKey([...pts].reverse(), 2000));
  });

  it('differs for a different radius', () => {
    const pts = [p(8.1, 47.1), p(8.2, 47.2)];
    expect(corridorKey(pts, 2000)).not.toBe(corridorKey(pts, 5000));
  });

  it('differs for distant corridors', () => {
    expect(corridorKey([p(8.1, 47.1)], 2000)).not.toBe(corridorKey([p(9.9, 48.8)], 2000));
  });
});

describe('buildStageQueries', () => {
  const pts = [p(8.1, 47.1), p(8.2, 47.2)];

  it('builds a two-stage query pair with lat,lon around clause', () => {
    const [q1, q2] = buildStageQueries(pts, 2000);
    expect(q1).toContain('way["highway"~"^(track|path|cycleway|bridleway)$"]');
    expect(q2).toContain('unclassified');
    for (const q of [q1, q2]) {
      expect(q).toContain('(around:2000,47.100000,8.100000,47.200000,8.200000)');
      expect(q).toContain('[out:json][timeout:90]');
      expect(q).toContain('out body');
    }
  });

  it('supports single-point corridors (first waypoint)', () => {
    const [q1] = buildStageQueries([p(8.1, 47.1)], 2000);
    expect(q1).toContain('(around:2000,47.100000,8.100000)');
  });
});
