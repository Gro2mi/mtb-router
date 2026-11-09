import { describe, expect, it } from 'vitest';
import { regionCovers, regionFor, type LoadInfo } from '../../src/engine/workerCoverage';

/**
 * Graph-reuse coverage (user bug: a waypoint near the loaded region's edge
 * snapped onto a trail whose junctions lay outside the built graph — the leg
 * degraded into a beeline). Reuse requires the WHOLE new corridor region to
 * fit inside the loaded region, not just the waypoints.
 */
describe('workerCoverage.regionCovers', () => {
  // load from two points with 2 km → region spans roughly 11.333-11.393 lng
  const loaded: LoadInfo = {
    region: regionFor(
      [
        [11.359, 47.221],
        [11.366, 47.224],
      ],
      2000,
    ),
    radiusM: 2000,
  };

  it('covers a plan well inside the loaded region', () => {
    const near = [
      [11.363, 47.222],
      [11.365, 47.2235],
    ] as [number, number][];
    expect(regionCovers(loaded, near, 2000)).toBe(true);
  });

  it('does NOT cover a waypoint near the region edge (the beeline bug)', () => {
    // ~2.5 km east of the load point: inside the OLD points-only check
    // (0.025 < 0.0264) but its 2 km corridor ring reaches past the edge
    const edge = [[11.385, 47.22], [11.366, 47.223]] as [number, number][];
    expect(regionCovers(loaded, edge, 2000)).toBe(false);
  });

  it('never covers an attempt asking for a larger radius', () => {
    const same = [[11.36, 47.22]] as [number, number][];
    expect(regionCovers(loaded, same, 5000)).toBe(false);
  });

  it('covers a plan after the region grew from a widening reload', () => {
    const grown: LoadInfo = {
      region: regionFor(
        [
          [11.35, 47.21],
          [11.39, 47.24],
        ],
        5000,
      ),
      radiusM: 5000,
    };
    const edge = [[11.385, 47.22], [11.366, 47.223]] as [number, number][];
    expect(regionCovers(grown, edge, 2000)).toBe(true);
  });
});
