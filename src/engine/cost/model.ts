/**
 * Difficulty cost model (E3.3, PLAN §7) — PURE module, no DOM, no imports of
 * reactive code. Direction-aware: each travel direction of a segment picks
 * its effective difficulty from the gradient (climbing → mtb:scale:uphill
 * bands, descending/flat → mtb:scale bands), enforces the hard upper limits,
 * applies the soft lower-limit penalties, the uphill forest-road preference,
 * and the push/carry walking model.
 */
import type { WayAttrs } from '../../lib/osm/tags';
import type { RiderSettings } from '../protocol';

// --- tuning constants (calibrated in E3.8; single source for tests) --------
export const COST = {
  /** flat-speed base per highway class, km/h */
  FLAT_SPEED_KMH: {
    track: 13,
    path: 9,
    cycleway: 17,
    bridleway: 8,
    service: 15,
    unclassified: 16,
    residential: 15,
    living_street: 14,
    tertiary: 17,
    secondary: 18,
    pedestrian: 6,
    footway: 6,
    steps: 4,
  } as Record<string, number>,
  /** speed multiplier per surface */
  SURFACE_FACTOR: {
    asphalt: 1.15,
    paved: 1.1,
    concrete: 1.1,
    concrete_lanes: 1.1,
    fine_gravel: 1.05,
    compacted: 1.0,
    wood: 0.9,
    gravel: 0.9,
    pebblestone: 0.8,
    woodchips: 0.8,
    dirt: 0.8,
    ground: 0.8,
    grass: 0.7,
    sand: 0.6,
    mud: 0.55,
    rock: 0.5,
    scree: 0.45,
  } as Record<string, number>,
  /** speed drag per unit of the direction's effective difficulty */
  DIFFICULTY_DRAG: 0.09,
  /** gradient threshold that separates climb/descend from flat */
  CLIMB_THRESHOLD: 0.04,
  /** vertical climb rate uphill, vm/h, by effective uphill difficulty */
  CLIMB_RATE_VMH: 420,
  CLIMB_RATE_DECAY: 45, // minus per difficulty step, floor CLIMB_RATE_MIN
  CLIMB_RATE_MIN: 220,
  /** downhill boost: v × (1 + min(MAX_BOOST, FACTOR × descSlope)) */
  DESC_BOOST_FACTOR: 2.0,
  DESC_BOOST_MAX: 1.1,
  /** downhill speed cap km/h: 34 − CAP_DECAY × difficulty, floor CAP_MIN */
  DESC_CAP_KMH: 34,
  DESC_CAP_DECAY: 3.5,
  DESC_CAP_MIN: 8,
  /** soft lower-limit penalty per step below the preferred minimum */
  SOFT_MIN_PENALTY: 0.35,
  /** uphill forest-road reward (× 1 − FACTOR × preference) */
  FOREST_REWARD: 0.6,
  /** uphill singletrail penalty (× 1 + FACTOR × pref × (1 − rideability)) */
  TRAIL_PENALTY: 0.8,
  /** avoid-untagged-singletrail penalty multiplier */
  UNTAGGED_TRAIL_PENALTY: 1.6,
  /** push/carry walking: speed m/s and climb rate vm/h */
  PUSH_SPEED_MS: 1.25,
  PUSH_CLIMB_VMH: 300,
  /** beeline over unknown terrain (conservative off-road estimate) */
  BEELINE_SPEED_MS: 8 / 3.6,
  /** SAC levels (T1..T6) */
  SAC_LEVELS: {
    hiking: 1,
    mountain_hiking: 2,
    demanding_mountain_hiking: 3,
    alpine_hiking: 4,
    demanding_alpine_hiking: 5,
    difficult_alpine_hiking: 6,
  } as Record<string, number>,
  /** surfaces that indicate a "good" forest road for inference */
  FINE_SURFACES: new Set([
    'asphalt',
    'paved',
    'concrete',
    'concrete:lanes',
    'concrete_lanes',
    'fine_gravel',
    'compacted',
    'gravel',
  ]),
} as const;

const KMH_TO_MS = 1 / 3.6;
const VMH_TO_MS = 1 / 3600;

/** The surfaces that make a way a "forest road" for the uphill preference (PLAN §7.6). */
export function isForestRoad(attrs: WayAttrs): boolean {
  if (!['track', 'service', 'unclassified'].includes(attrs.highway)) return false;
  const goodTracktype = attrs.tracktype === 'grade1' || attrs.tracktype === 'grade2';
  const goodSurface = attrs.surface !== undefined && COST.FINE_SURFACES.has(attrs.surface);
  return goodTracktype || goodSurface;
}

export interface EffectiveDifficulty {
  /** mtb:scale semantics (downhill/flat), 0..6 */
  mtbDown: number;
  /** mtb:scale:uphill semantics, 0..5 */
  mtbUp: number;
  /** sac level 1..6 */
  sac: number;
  /** an explicit mtb tag was present (vs inferred, PLAN §7.5) */
  taggedMtb: boolean;
  /** an explicit sac_scale tag was present (route labels: prefer S over T) */
  taggedSac: boolean;
}

/**
 * Effective difficulty per direction with conservative inference for untagged
 * ways (PLAN §7.4/7.5) and sac→mtb cross-inference.
 */
export function effectiveDifficulty(attrs: WayAttrs): EffectiveDifficulty {
  const taggedMtb = attrs.mtbScale !== undefined || attrs.mtbScaleUphill !== undefined;
  let mtbDown: number;
  let mtbUp: number;
  let sac: number;

  if (attrs.isSteps) {
    mtbDown = 3;
    mtbUp = 4;
    sac = 2;
  } else if (attrs.highway === 'track') {
    if (attrs.tracktype === 'grade1' || attrs.tracktype === 'grade2') {
      mtbDown = 0;
      mtbUp = 0;
      sac = 1;
    } else {
      mtbDown = 1;
      mtbUp = 1;
      sac = 2;
    }
  } else if (attrs.highway === 'path') {
    if (attrs.surface === 'rock' || attrs.surface === 'scree' || attrs.surface === 'mud') {
      mtbDown = 2;
      mtbUp = 2;
      sac = 3;
    } else {
      mtbDown = 1;
      mtbUp = 1;
      sac = 2;
    }
  } else if (attrs.highway === 'footway' || attrs.highway === 'pedestrian') {
    mtbDown = 1;
    mtbUp = 1;
    sac = 1;
  } else {
    // cycleway, service, residential, roads…
    mtbDown = 0;
    mtbUp = 0;
    sac = 1;
  }

  // explicit tags win over inference
  if (attrs.mtbScale !== undefined) mtbDown = attrs.mtbScale;
  if (attrs.mtbScaleUphill !== undefined) mtbUp = attrs.mtbScaleUphill;
  if (attrs.sacScale !== undefined) {
    const level = COST.SAC_LEVELS[attrs.sacScale];
    if (level !== undefined) sac = level;
  }

  // cross-inference: harder hiking scale implies harder riding (PLAN §7.5)
  if (sac >= 3) {
    mtbDown = Math.max(mtbDown, sac - 1);
    mtbUp = Math.max(mtbUp, Math.min(5, sac));
  }
  return { mtbDown, mtbUp, sac, taggedMtb, taggedSac: attrs.sacScale !== undefined };
}

export interface SegmentCost {
  costFwd: number;
  costBwd: number;
  excludedFwd: boolean;
  excludedBwd: boolean;
}

function climbRateMs(mtbUp: number): number {
  const vmh = Math.max(COST.CLIMB_RATE_MIN, COST.CLIMB_RATE_VMH - COST.CLIMB_RATE_DECAY * mtbUp);
  return vmh * VMH_TO_MS;
}

function flatSpeedMs(attrs: WayAttrs, difficulty: number): number {
  const base = COST.FLAT_SPEED_KMH[attrs.highway] ?? 12;
  const surf = attrs.surface !== undefined ? COST.SURFACE_FACTOR[attrs.surface] : undefined;
  return base * (surf ?? 1) * (1 - COST.DIFFICULTY_DRAG * difficulty) * KMH_TO_MS;
}

/** Per-direction time for one direction of a segment; returns seconds or Infinity if excluded. */
function directionCost(
  attrs: WayAttrs,
  eff: EffectiveDifficulty,
  settings: RiderSettings,
  climb: number, // ≥ 0, dimensionless
  oppositeClimb: number,
  lenM: number,
): { cost: number; excluded: boolean } {
  const isClimb = climb >= COST.CLIMB_THRESHOLD;
  const isDesc = oppositeClimb >= COST.CLIMB_THRESHOLD;
  const band = isClimb ? settings.uphill : settings.downhill;
  const mtb = isClimb ? eff.mtbUp : eff.mtbDown;

  // riding-prohibited ways (footways, bicycle=no) are walkable always — they
  // ignore MTB bands so every displayed trail stays snap/routable, but SAC
  // bands still apply (alpine safety)
  if (attrs.walkingOnly) {
    if (eff.sac > band.sac.max) return { cost: Infinity, excluded: true };
    return {
      cost: lenM / COST.PUSH_SPEED_MS + (climb * lenM) / (COST.PUSH_CLIMB_VMH * VMH_TO_MS),
      excluded: false,
    };
  }

  // hard upper limits in this direction (PLAN §7.3)
  const excluded = mtb > band.mtb.max || eff.sac > band.sac.max;
  if (excluded) return { cost: Infinity, excluded: true };

  // push/carry model (mtb:scale:uphill ≥ 4 = "even strong riders push")
  if (isClimb && eff.mtbUp >= 4) {
    return {
      cost: lenM / COST.PUSH_SPEED_MS + (climb * lenM) / (COST.PUSH_CLIMB_VMH * VMH_TO_MS),
      excluded: false,
    };
  }
  // steps are always portage (PLAN §7.5)
  if (attrs.isSteps) {
    return {
      cost: lenM / COST.PUSH_SPEED_MS + (climb * lenM) / (COST.PUSH_CLIMB_VMH * VMH_TO_MS),
      excluded: false,
    };
  }
  // mtb:scale 6 is not rideable at all — walk it in any direction
  if (!isClimb && eff.mtbDown >= 6) {
    return { cost: lenM / COST.PUSH_SPEED_MS, excluded: false };
  }

  const v = flatSpeedMs(attrs, mtb);
  let time: number;
  if (isClimb) {
    time = lenM / v + (climb * lenM) / climbRateMs(eff.mtbUp);
  } else if (isDesc) {
    const boosted = v * (1 + Math.min(COST.DESC_BOOST_MAX, COST.DESC_BOOST_FACTOR * oppositeClimb));
    const capped = Math.min(
      boosted,
      (COST.DESC_CAP_KMH - COST.DESC_CAP_DECAY * eff.mtbDown) * KMH_TO_MS,
    );
    time = lenM / Math.max(capped, COST.DESC_CAP_MIN * KMH_TO_MS);
  } else {
    time = lenM / v;
  }

  // soft lower limits — never exclude, just make it more expensive (PLAN §7.3)
  let penalty = 1;
  if (mtb < band.mtb.min)
    penalty = Math.max(penalty, 1 + COST.SOFT_MIN_PENALTY * (band.mtb.min - mtb));
  if (eff.sac < band.sac.min)
    penalty = Math.max(penalty, 1 + COST.SOFT_MIN_PENALTY * (band.sac.min - eff.sac));
  time *= penalty;

  // uphill forest-road preference (FR-6)
  if (isClimb) {
    if (isForestRoad(attrs)) {
      time *= 1 - COST.FOREST_REWARD * settings.forestRoadPreference;
    } else if (attrs.highway === 'path') {
      const rideability = Math.max(0, Math.min(1, 1 - eff.mtbUp / 5));
      time *= 1 + COST.TRAIL_PENALTY * settings.forestRoadPreference * (1 - rideability);
    }
  }
  // optional safety penalization of untagged singletrail
  if (settings.avoidUntaggedSingletrail && !eff.taggedMtb && attrs.highway === 'path') {
    time *= COST.UNTAGGED_TRAIL_PENALTY;
  }
  return { cost: time, excluded: false };
}

/**
 * Costs for one segment of length `lenM` meters. `climbFwd`/`climbBwd` are the
 * absolute gradient (Δz/len, ≥ 0) when traveling forward (geometry direction)
 * or backward respectively. Costs are seconds; excluded directions are ±Infinity.
 */
export function costFor(
  attrs: WayAttrs,
  climbFwd: number,
  climbBwd: number,
  lenM: number,
  settings: RiderSettings,
): SegmentCost {
  const eff = effectiveDifficulty(attrs);
  const fwd = directionCost(attrs, eff, settings, climbFwd, climbBwd, lenM);
  const bwd = directionCost(attrs, eff, settings, climbBwd, climbFwd, lenM);
  return {
    costFwd: fwd.cost,
    costBwd: bwd.cost,
    excludedFwd: fwd.excluded,
    excludedBwd: bwd.excluded,
  };
}
