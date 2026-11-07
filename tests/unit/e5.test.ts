import { describe, expect, it } from 'vitest';
import { difficultyColor, segmentColor, WALKING_COLOR } from '../../src/lib/map/difficultyColors';
import { buildProfileData, profileAt } from '../../src/lib/profile/profileData';
import type { RouteResult, RouteSegment } from '../../src/engine/protocol';

function seg(over: Partial<RouteSegment> = {}): RouteSegment {
  return {
    wayId: 1,
    highway: 'track',
    mtbDown: 0,
    mtbUp: 0,
    sac: 1,
    difficultyTagged: false,
    coords: [
      [47.0, 8.0, 500],
      [47.001, 8.001, 520],
    ],
    distanceM: 100,
    ascentM: 20,
    descentM: 0,
    timeS: 30,
    difficulty: 0,
    walking: false,
    slope: 0.2,
    ...over,
  };
}

function route(legs: RouteSegment[][]): RouteResult {
  return {
    legs: legs.map((segments) => ({
      segments,
      distanceM: segments.reduce((s, x) => s + x.distanceM, 0),
      ascentM: 0,
      descentM: 0,
      timeS: 0,
    })),
    total: { distanceM: 0, ascentM: 0, descentM: 0, timeS: 0 },
    kmByMtb: [0, 0, 0, 0, 0, 0, 0],
    radiusM: 2000,
    elevationAvailable: true,
  };
}

describe('difficulty colors (E5.1)', () => {
  it('maps the IMBA-inspired palette', () => {
    expect(difficultyColor(0)).toBe('#2e7d32');
    expect(difficultyColor(1)).toBe('#1565c0');
    expect(difficultyColor(2)).toBe('#ef6c00');
    expect(difficultyColor(3)).toBe('#212121');
    expect(difficultyColor(6)).toBe('#7f1734');
  });

  it('clamps out-of-range levels', () => {
    expect(difficultyColor(-3)).toBe(difficultyColor(0));
    expect(difficultyColor(99)).toBe(difficultyColor(6));
  });

  it('colors walking edges gray regardless of difficulty', () => {
    expect(segmentColor({ mtbDown: 0, mtbUp: 0, walking: true })).toBe(WALKING_COLOR);
  });

  it('prefers the explicit difficulty over the scales', () => {
    expect(segmentColor({ mtbDown: 0, mtbUp: 5, difficulty: 1 })).toBe(difficultyColor(1));
  });

  it('falls back to max(scale) for legacy records without difficulty', () => {
    expect(segmentColor({ mtbDown: 1, mtbUp: 3 })).toBe(difficultyColor(3));
  });
});

describe('profile data (E5.3)', () => {
  const r = route([
    [
      seg({
        coords: [
          [47.0, 8.0, 500],
          [47.001, 8.001, 520],
        ],
        distanceM: 100,
        difficulty: 0,
      }),
      seg({
        coords: [
          [47.001, 8.001, 520],
          [47.002, 8.002, 480],
        ],
        distanceM: 120,
        difficulty: 2,
      }),
    ],
  ]);

  const data = buildProfileData(r);

  it('dedupes joint vertices and accumulates distance', () => {
    expect(data.samples).toHaveLength(3); // 500 → 520 → 480
    expect(data.totalM).toBe(220);
    expect(data.samples[0]!.dM).toBe(0);
    expect(data.samples[1]!.dM).toBe(100);
    expect(data.samples[2]!.dM).toBe(220);
    expect(data.available).toBe(true);
    expect(data.minEle).toBe(480);
    expect(data.maxEle).toBe(520);
  });

  it('carries per-interval difficulty colors', () => {
    expect(data.samples[1]!.color).toBe(difficultyColor(0)); // interval 0→100
    expect(data.samples[2]!.color).toBe(difficultyColor(2)); // interval 100→220
  });

  it('interpolates position and elevation at intermediate distances', () => {
    const mid = profileAt(data, 50)!;
    expect(mid.lat).toBeCloseTo(47.0005, 6);
    expect(mid.ele).toBeCloseTo(510, 6);
    expect(mid.color).toBe(difficultyColor(0));

    const second = profileAt(data, 160)!; // 60/120 into the second interval
    expect(second.ele).toBeCloseTo(520 - 40 * 0.5, 6);
    expect(second.difficulty).toBe(2);
  });

  it('returns null outside the route', () => {
    expect(profileAt(data, -1)).toBeNull();
    expect(profileAt(data, 221)).toBeNull();
  });

  it('marks degraded routes unavailable', () => {
    const degraded = buildProfileData(
      route([
        [
          seg({
            coords: [
              [47.0, 8.0, null],
              [47.001, 8.001, null],
            ],
            distanceM: 100,
          }),
        ],
      ]),
    );
    expect(degraded.available).toBe(false);
  });

  it('handles a single-segment route', () => {
    const single = buildProfileData(route([[seg()]]));
    expect(single.samples).toHaveLength(2);
    expect(profileAt(single, 100)).not.toBeNull();
  });
});
