/**
 * Difficulty presets (E4.2, PLAN §7.2): built-in rider profiles and
 * custom-state detection. Pure module — unit-tested.
 */
import type { RiderSettings } from '../../engine/protocol';

export type PresetId = 'easy' | 'allmountain' | 'enduro' | 'custom';

export interface Preset {
  id: Exclude<PresetId, 'custom'>;
  settings: RiderSettings;
}

export const PRESETS: Preset[] = [
  {
    id: 'easy',
    settings: {
      uphill: { mtb: { min: 0, max: 1 }, sac: { min: 1, max: 2 } },
      downhill: { mtb: { min: 0, max: 1 }, sac: { min: 1, max: 3 } },
      forestRoadPreference: 0.8,
      avoidUntaggedSingletrail: false,
    },
  },
  {
    id: 'allmountain',
    settings: {
      uphill: { mtb: { min: 0, max: 2 }, sac: { min: 1, max: 3 } },
      downhill: { mtb: { min: 0, max: 3 }, sac: { min: 1, max: 4 } },
      forestRoadPreference: 0.5,
      avoidUntaggedSingletrail: false,
    },
  },
  {
    id: 'enduro',
    settings: {
      uphill: { mtb: { min: 0, max: 3 }, sac: { min: 1, max: 4 } },
      downhill: { mtb: { min: 1, max: 4 }, sac: { min: 2, max: 5 } },
      forestRoadPreference: 0.2,
      avoidUntaggedSingletrail: false,
    },
  },
];

const sameBand = (
  a: { mtb: { min: number; max: number }; sac: { min: number; max: number } },
  b: { mtb: { min: number; max: number }; sac: { min: number; max: number } },
): boolean =>
  a.mtb.min === b.mtb.min &&
  a.mtb.max === b.mtb.max &&
  a.sac.min === b.sac.min &&
  a.sac.max === b.sac.max;

/** The preset matching the settings, or 'custom' when none does. */
export function matchPreset(settings: RiderSettings): PresetId {
  const found = PRESETS.find(
    (p) =>
      sameBand(p.settings.uphill, settings.uphill) &&
      sameBand(p.settings.downhill, settings.downhill) &&
      Math.abs(p.settings.forestRoadPreference - settings.forestRoadPreference) < 0.01 &&
      p.settings.avoidUntaggedSingletrail === settings.avoidUntaggedSingletrail,
  );
  return found ? found.id : 'custom';
}

/** A user-saved preset (E4.2). */
export interface CustomPreset {
  id: string;
  name: string;
  settings: RiderSettings;
}

/** id of the custom preset matching the settings, or null. */
export function matchCustomId(settings: RiderSettings, customs: CustomPreset[]): string | null {
  const found = customs.find(
    (p) =>
      sameBand(p.settings.uphill, settings.uphill) &&
      sameBand(p.settings.downhill, settings.downhill) &&
      Math.abs(p.settings.forestRoadPreference - settings.forestRoadPreference) < 0.01 &&
      p.settings.avoidUntaggedSingletrail === settings.avoidUntaggedSingletrail,
  );
  return found ? found.id : null;
}

/** Clamp a band so min ≤ max within [lo, hi]. */
export function clampBand(
  value: number,
  other: number,
  lo: number,
  hi: number,
): { value: number; other: number } {
  const v = Math.max(lo, Math.min(hi, Math.round(value)));
  const o = Math.max(lo, Math.min(hi, Math.round(other)));
  return v <= o ? { value: v, other: o } : { value: o, other: v };
}
