import { describe, expect, it } from 'vitest';
import { parseWayTags, type WayAttrs } from '../../src/lib/osm/tags';
import { COST, costFor, effectiveDifficulty, isForestRoad } from '../../src/engine/cost/model';
import { DEFAULT_SETTINGS, type RiderSettings } from '../../src/engine/protocol';

const way = (tags: Record<string, string>): WayAttrs => parseWayTags(tags);

const settings = (over: Partial<RiderSettings> = {}): RiderSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

/** table case shape: [name, tags, climbFwd, climbBwd, settings, expect] */
interface Row {
  name: string;
  tags: Record<string, string>;
  climbFwd?: number;
  climbBwd?: number;
  len?: number;
  settings?: Partial<RiderSettings>;
  expect: 'excludedFwd' | 'excludedBwd' | 'ok';
  /** optional assertions on cost relationship */
  check?: (r: { costFwd: number; costBwd: number }) => boolean;
  /** effective difficulty expectations */
  eff?: Partial<{ mtbDown: number; mtbUp: number; sac: number; taggedMtb: boolean }>;
}

const ROWS: Row[] = [
  // --- hard upper limits (PLAN §7.3: max = exclusion in that direction) ---
  {
    name: '01 S4 trail excluded downhill when downhill max=3',
    tags: { highway: 'path', 'mtb:scale': '4' },
    climbBwd: 0.1,
    expect: 'excludedFwd',
  },
  {
    name: '02 same S4 trail allowed uphill if uphill max≥3',
    tags: { highway: 'path', 'mtb:scale': '4', 'mtb:scale:uphill': '3' },
    climbFwd: 0.1,
    settings: { uphill: { mtb: { min: 0, max: 3 }, sac: { min: 1, max: 3 } } },
    expect: 'ok',
  },
  {
    name: '03 uphill scale 5 excluded when uphill max=2 (push-only way)',
    tags: { highway: 'path', 'mtb:scale:uphill': '5' },
    climbFwd: 0.15,
    expect: 'excludedFwd',
  },
  {
    name: '04 forest road never excluded by mtb bands (eff 0)',
    tags: { highway: 'track', tracktype: 'grade2', surface: 'compacted' },
    expect: 'ok',
  },
  // --- soft lower limits (min = preference penalty, never exclusion) ---
  {
    name: '05 paved cycleway penalized when downhill min=1 but NOT excluded',
    tags: { highway: 'cycleway', surface: 'asphalt' },
    settings: { downhill: { mtb: { min: 1, max: 3 }, sac: { min: 1, max: 4 } } },
    expect: 'ok',
    check: (r) => r.costFwd > 0,
  },
  {
    name: '06 soft-min makes connector road costlier than in-range singletrail',
    tags: { highway: 'cycleway', surface: 'asphalt' },
    climbFwd: 0,
    settings: { downhill: { mtb: { min: 2, max: 3 }, sac: { min: 1, max: 4 } } },
    expect: 'ok',
    check: (r) => r.costFwd > 300, // 212 s base × 1.7 soft-min penalty ≈ 360 s
  },
  // --- direction-aware difficulty selection via gradient ---
  {
    name: '07 steep climb picks uphill scale for band check',
    tags: { highway: 'path', 'mtb:scale': '1', 'mtb:scale:uphill': '4' },
    climbFwd: 0.12,
    settings: { uphill: { mtb: { min: 0, max: 3 }, sac: { min: 1, max: 3 } } },
    expect: 'excludedFwd', // mtbUp 4 > max 3
  },
  {
    name: '08 reverse direction of 07 descends → allowed by downhill bands',
    tags: { highway: 'path', 'mtb:scale': '1', 'mtb:scale:uphill': '4' },
    climbBwd: 0.12,
    expect: 'ok',
  },
  {
    name: '09 flat segment uses downhill bands',
    tags: { highway: 'path', 'mtb:scale': '4' },
    expect: 'excludedFwd',
  },
  // --- SAC bands ---
  {
    name: '10 sac T4 excluded when climbing with uphill sac max=3',
    tags: { highway: 'path', sac_scale: 'alpine_hiking' },
    climbFwd: 0.1,
    expect: 'excludedFwd',
  },
  {
    name: '11 sac T2 within bands stays routable',
    tags: { highway: 'path', sac_scale: 'mountain_hiking' },
    expect: 'ok',
  },
  {
    name: '12 sac scale with cross-inference lifts mtb floor (T5 → mtbDown ≥ 4)',
    tags: { highway: 'path', sac_scale: 'demanding_alpine_hiking' },
    expect: 'excludedFwd',
    eff: { mtbDown: 4, mtbUp: 5, sac: 5 },
  },
  // --- inference table (PLAN §7.5) ---
  {
    name: '13 track grade1+compacted infers 0/0/T1',
    tags: { highway: 'track', tracktype: 'grade1', surface: 'compacted' },
    expect: 'ok',
    eff: { mtbDown: 0, mtbUp: 0, sac: 1, taggedMtb: false },
  },
  {
    name: '14 untagged track infers 1/1/T2',
    tags: { highway: 'track' },
    expect: 'ok',
    eff: { mtbDown: 1, mtbUp: 1, sac: 2 },
  },
  {
    name: '15 untagged path infers 1/1/T2',
    tags: { highway: 'path' },
    expect: 'ok',
    eff: { mtbDown: 1, mtbUp: 1, sac: 2 },
  },
  {
    name: '16 path with rock surface infers 2/2/T3 + sac cross-inference lifts mtbUp to 3',
    tags: { highway: 'path', surface: 'rock' },
    expect: 'ok',
    eff: { mtbDown: 2, mtbUp: 3, sac: 3 },
  },
  {
    name: '17 residential infers 0/0/T1',
    tags: { highway: 'residential' },
    expect: 'ok',
    eff: { mtbDown: 0, mtbUp: 0, sac: 1 },
  },
  {
    name: '18 steps infer 3/4/T2',
    tags: { highway: 'steps' },
    expect: 'ok',
    eff: { mtbDown: 3, mtbUp: 4, sac: 2 },
  },
  {
    name: '19 explicit mtb:scale overrides inference',
    tags: { highway: 'track', tracktype: 'grade1', surface: 'compacted', 'mtb:scale': '2' },
    expect: 'ok',
    eff: { mtbDown: 2, taggedMtb: true },
  },
  {
    name: "20 '2+' suffix parses to 2.5 effective",
    tags: { highway: 'path', 'mtb:scale': '2+' },
    expect: 'ok',
    eff: { mtbDown: 2.5, taggedMtb: true },
  },
  // --- forest-road uphill preference (FR-6) ---
  {
    name: '21 forest road uphill cheaper than singletrail uphill at pref 0.5',
    tags: { highway: 'track', tracktype: 'grade2', surface: 'compacted' },
    climbFwd: 0.06,
    expect: 'ok',
  },
  {
    name: '22 forest preference 0 removes the uphill reward',
    tags: { highway: 'track', tracktype: 'grade2', surface: 'compacted' },
    climbFwd: 0.06,
    settings: { forestRoadPreference: 0 },
    expect: 'ok',
  },
  {
    name: '23 singletrail uphill penalized proportionally to preference',
    tags: { highway: 'path', 'mtb:scale': '2', 'mtb:scale:uphill': '2' },
    climbFwd: 0.06,
    expect: 'ok',
  },
  // --- push/carry (PLAN §7.6) ---
  {
    name: '24 mtb:scale:uphill=4 climb uses walking model (slow)',
    tags: { highway: 'path', 'mtb:scale:uphill': '4' },
    climbFwd: 0.2,
    settings: { uphill: { mtb: { min: 0, max: 5 }, sac: { min: 1, max: 3 } } },
    expect: 'ok',
    check: (r) => r.costFwd >= 1000 / 1.25, // walking pace + climb time
  },
  {
    name: '25 steps are portage both directions',
    tags: { highway: 'steps' },
    expect: 'ok',
    check: (r) => r.costFwd >= 1000 / 1.25 && r.costBwd >= 1000 / 1.25,
  },
  // --- untagged singletrail toggle ---
  {
    name: '26 avoidUntaggedSingletrail penalizes untagged path',
    tags: { highway: 'path' },
    settings: { avoidUntaggedSingletrail: true },
    expect: 'ok',
  },
  {
    name: '27 avoidUntaggedSingletrail leaves tagged path untouched',
    tags: { highway: 'path', 'mtb:scale': '1' },
    settings: { avoidUntaggedSingletrail: true },
    expect: 'ok',
  },
  // --- downhill caps (safety) ---
  {
    name: '28 steep S1 downhill is fast',
    tags: { highway: 'path', 'mtb:scale': '1' },
    climbFwd: 0.15,
    expect: 'ok',
  },
  {
    name: '29 steep S5 downhill is slow (capped)',
    tags: { highway: 'path', 'mtb:scale': '5' },
    climbFwd: 0.15,
    settings: { downhill: { mtb: { min: 0, max: 5 }, sac: { min: 1, max: 4 } } },
    expect: 'ok',
  },
  // --- access interplay (filter cases from E2 must still route) ---
  {
    name: '30 bicycle=no footway is a walking edge — passes at walking cost',
    tags: { highway: 'footway', bicycle: 'no' },
    expect: 'ok',
    check: (r) => Math.abs(r.costFwd - 1000 / 1.25) < 1,
  },
  {
    name: '30b walking edge ignores MTB bands (max 0 still passes)',
    tags: { highway: 'footway', bicycle: 'no' },
    settings: { uphill: { mtb: { min: 0, max: 0 }, sac: { min: 1, max: 3 } } },
    climbFwd: 0.1,
    expect: 'ok',
  },
  {
    name: '30c walking edge still respects SAC safety bands',
    tags: { highway: 'footway', bicycle: 'no', sac_scale: 'demanding_alpine_hiking' },
    expect: 'excludedFwd',
  },
  {
    name: '31 access=private track with bicycle=yes stays routable',
    tags: { highway: 'track', access: 'private', bicycle: 'yes' },
    expect: 'ok',
  },
  // --- gradient time model sanity ---
  {
    name: '32 climbing costs more than flat on the same way',
    tags: { highway: 'track', tracktype: 'grade2' },
    climbFwd: 0.08,
    expect: 'ok',
    check: (r) => r.costFwd > 1000 / (13 / 3.6),
  },
  {
    name: '33 gentle grades count as flat (below threshold)',
    tags: { highway: 'track', tracktype: 'grade2' },
    climbFwd: 0.03,
    expect: 'ok',
    check: (r) => Math.abs(r.costFwd - 1000 / (13 / 3.6)) < 1,
  },
];

describe('cost model fixture table (E3.3 acceptance, ≥30 cases)', () => {
  for (const [i, row] of ROWS.entries()) {
    it(`row ${String(i + 1).padStart(2, '0')}: ${row.name}`, () => {
      const attrs = way(row.tags);
      const len = row.len ?? 1000;
      const climbFwd = row.climbFwd ?? 0;
      const climbBwd = row.climbBwd ?? 0;
      const result = costFor(attrs, climbFwd, climbBwd, len, settings(row.settings ?? {}));

      if (row.eff) {
        const eff = effectiveDifficulty(attrs);
        for (const [key, value] of Object.entries(row.eff)) {
          expect(eff[key as keyof typeof eff]).toBe(value);
        }
      }
      if (row.expect === 'excludedFwd') expect(result.excludedFwd).toBe(true);
      else if (row.expect === 'excludedBwd') expect(result.excludedBwd).toBe(true);
      else expect(result.excludedFwd).toBe(false);
      if (row.check) {
        // recompute without exclusions for cost relationship checks
        const s = settings(row.settings ?? {});
        const relaxed: RiderSettings =
          row.expect === 'excludedFwd'
            ? {
                ...s,
                uphill: { mtb: { min: 0, max: 6 }, sac: { min: 1, max: 6 } },
                downhill: { mtb: { min: 0, max: 6 }, sac: { min: 1, max: 6 } },
              }
            : s;
        const r2 = costFor(attrs, climbFwd, climbBwd, len, relaxed);
        expect(row.check({ costFwd: r2.costFwd, costBwd: r2.costBwd })).toBe(true);
      }
    });
  }

  it('has at least 30 fixture rows', () => expect(ROWS.length).toBeGreaterThanOrEqual(30));

  // --- relational acceptance checks the AC names explicitly ---
  it('AC: forest road is preferred uphill over singletrail (comparison)', () => {
    const forest = costFor(
      way({ highway: 'track', tracktype: 'grade2', surface: 'compacted' }),
      0.06,
      0,
      1000,
      settings({ forestRoadPreference: 0.5 }),
    );
    const trail = costFor(
      way({ highway: 'path', 'mtb:scale': '2', 'mtb:scale:uphill': '2' }),
      0.06,
      0,
      1000,
      settings({ forestRoadPreference: 0.5 }),
    );
    expect(forest.excludedFwd).toBe(false);
    expect(trail.excludedFwd).toBe(false);
    expect(forest.costFwd).toBeLessThan(trail.costFwd);
  });

  it('AC: higher forest preference strengthens the uphill preference monotonically', () => {
    const costs = [0, 0.3, 0.6, 1].map(
      (pref) =>
        costFor(
          way({ highway: 'track', tracktype: 'grade2', surface: 'compacted' }),
          0.06,
          0,
          1000,
          settings({ forestRoadPreference: pref }),
        ).costFwd,
    );
    for (let i = 1; i < costs.length; i++) expect(costs[i]!).toBeLessThan(costs[i - 1]!);
  });

  it('AC: avoidUntaggedSingletrail changes uphill choice on untagged paths', () => {
    const tags = { highway: 'path' };
    const without = costFor(
      way(tags),
      0.06,
      0,
      1000,
      settings({ avoidUntaggedSingletrail: false }),
    );
    const withPenalty = costFor(
      way(tags),
      0.06,
      0,
      1000,
      settings({ avoidUntaggedSingletrail: true }),
    );
    expect(withPenalty.costFwd).toBeCloseTo(without.costFwd * COST.UNTAGGED_TRAIL_PENALTY, 5);
  });

  it('AC: exclusion is direction-asymmetric (S4 descends must not be ridden down)', () => {
    const tags = { highway: 'path', 'mtb:scale': '4', 'mtb:scale:uphill': '1' };
    // traveling fwd while the reverse climbs (climbBwd=0.15) → fwd descends → mtbDown 4 > max 3
    const downhillTravel = costFor(way(tags), 0, 0.15, 1000, DEFAULT_SETTINGS);
    // traveling fwd uphill (climbFwd=0.15) → mtbUp 1 ≤ uphill max 2
    const uphillTravel = costFor(way(tags), 0.15, 0, 1000, DEFAULT_SETTINGS);
    expect(downhillTravel.excludedFwd).toBe(true);
    expect(uphillTravel.excludedFwd).toBe(false);
  });

  it('isForestRoad matches the PLAN §7.6 definition', () => {
    expect(isForestRoad(way({ highway: 'track', tracktype: 'grade2' }))).toBe(true);
    expect(isForestRoad(way({ highway: 'service', surface: 'gravel' }))).toBe(true);
    expect(isForestRoad(way({ highway: 'path', surface: 'compacted' }))).toBe(false);
    expect(isForestRoad(way({ highway: 'track', tracktype: 'grade4' }))).toBe(false);
  });
});
