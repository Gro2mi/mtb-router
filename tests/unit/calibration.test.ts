import { describe, expect, it } from 'vitest';
import { costFor } from '../../src/engine/cost/model';
import { DEFAULT_SETTINGS, type RiderSettings } from '../../src/engine/protocol';

/**
 * E3.8 calibration regression fixtures (docs/CALIBRATION.md): these pin the
 * time estimates for representative synthetic routes. When you tune the COST
 * constants against real rides, update the expected numbers here — the diffs
 * then document exactly how much each tuning changed the estimates.
 */
const settings: RiderSettings = DEFAULT_SETTINGS;

function track(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { highway: 'track', surface: 'compacted', tracktype: 'grade2', ...over };
}

/** forward time for one segment, in minutes */
function minutes(
  tags: Record<string, unknown>,
  lenM: number,
  climbFwd = 0,
  climbBwd = 0,
  rider = settings,
): number {
  const c = costFor(tags as never, climbFwd, climbBwd, lenM, rider);
  expect(c.excludedFwd).toBe(false);
  return c.costFwd / 60;
}

describe('calibration fixtures (E3.8) — pin current model behavior', () => {
  /**
   * Numbers are pinned from the CURRENT COST constants (2026-11-07, see
   * docs/CALIBRATION.md). When you tune against real rides, re-derive these
   * with the same helper and update — the diff documents the tuning delta.
   * Direction semantics: climbFwd = uphill when traveling forward;
   * climbBwd = uphill when traveling backward (= descending forward).
   */

  it('A — flat forest road, 10 km: 46.2 min (13 km/h avg)', () => {
    expect(minutes(track(), 10_000)).toBeCloseTo(46.15, 0);
  });

  it('B — rolling forest road, 5 km + 250 m (5 %): 41.2 min', () => {
    expect(minutes(track(), 5_000, 0.05)).toBeCloseTo(41.15, 1);
  });

  it('C — steep S2 climb, 2 km + 200 m (10 %): 26.5 min', () => {
    expect(minutes(track({ 'mtb:scale': '2' }), 2_000, 0.1)).toBeCloseTo(26.46, 1);
  });

  it('D — S3 descent traveling forward, 3 km − 240 m (8 %): 11.9 min', () => {
    // travel forward on a way whose reverse climbs 8 % = downhill forward
    expect(minutes(track({ 'mtb:scale': '3' }), 3_000, 0, 0.08)).toBeCloseTo(11.94, 1);
  });

  it('E — push/carry section, 500 m + 80 m at mtb:uphill 4: 17.8 min', () => {
    expect(minutes({ highway: 'path', 'mtb:scale:uphill': '4' }, 500, 0.16)).toBeCloseTo(17.78, 1);
  });

  it('F — asphalt cycleway, 10 km: 30.7 min (clearly faster than track)', () => {
    expect(minutes({ highway: 'cycleway', surface: 'asphalt' }, 10_000)).toBeCloseTo(30.69, 1);
    expect(minutes({ highway: 'cycleway', surface: 'asphalt' }, 10_000)).toBeLessThan(
      minutes(track(), 10_000),
    );
  });

  it('G — S1 singletrail climb, 5 km + 250 m: 82.8 min (trail + climb + soft-min penalties stack)', () => {
    expect(minutes({ highway: 'path', 'mtb:scale': '1' }, 5_000, 0.05)).toBeCloseTo(82.76, 1);
  });

  it('H — forest-road preference shortens the same uphill forest road', () => {
    const preferred = minutes(track(), 5_000, 0.05, 0, { ...settings, forestRoadPreference: 1 });
    const neutral = minutes(track(), 5_000, 0.05, 0, { ...settings, forestRoadPreference: 0 });
    expect(preferred).toBeLessThan(neutral);
  });

  it('I — sanity band: mixed all-mountain loop (10 km road + 5 km S2 climb + 5 km S3 descent) ≈ 2 h', () => {
    const totalMin =
      minutes(track(), 10_000) +
      minutes(track({ 'mtb:scale': '2' }), 5_000, 0.08) +
      minutes(track({ 'mtb:scale': '3' }), 5_000, 0, 0.08);
    expect(totalMin).toBeGreaterThan(60);
    expect(totalMin).toBeLessThan(150);
  });
});
