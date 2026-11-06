import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/engine/protocol';
import { PRESETS, clampBand, matchPreset } from '../../src/lib/ui/presets';

describe('presets (E4.2)', () => {
  it('has three built-in presets matching PLAN §7.2', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['easy', 'allmountain', 'enduro']);
  });

  it('default settings match the all-mountain preset', () => {
    expect(matchPreset(DEFAULT_SETTINGS)).toBe('allmountain');
  });

  it('matches each preset exactly', () => {
    for (const p of PRESETS) expect(matchPreset(p.settings)).toBe(p.id);
  });

  it('reports custom on any deviation', () => {
    const tweaked = {
      ...DEFAULT_SETTINGS,
      downhill: { ...DEFAULT_SETTINGS.downhill, mtb: { min: 0, max: 2 } },
    };
    expect(matchPreset(tweaked)).toBe('custom');
    expect(matchPreset({ ...DEFAULT_SETTINGS, avoidUntaggedSingletrail: true })).toBe('custom');
    expect(matchPreset({ ...DEFAULT_SETTINGS, forestRoadPreference: 0.49 })).toBe('custom');
  });

  it('tolerates tiny float drift in the forest preference', () => {
    expect(matchPreset({ ...DEFAULT_SETTINGS, forestRoadPreference: 0.5 + 0.005 })).toBe(
      'allmountain',
    );
  });
});

describe('clampBand', () => {
  it('clamps to the range', () => {
    expect(clampBand(-1, 9, 0, 6)).toEqual({ value: 0, other: 6 });
  });
  it('swaps inverted values', () => {
    expect(clampBand(4, 2, 0, 6)).toEqual({ value: 2, other: 4 });
  });
  it('keeps equal values (single-point band)', () => {
    expect(clampBand(3, 3, 0, 6)).toEqual({ value: 3, other: 3 });
  });
});
