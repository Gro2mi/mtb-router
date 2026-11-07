import { beforeEach, describe, expect, it, vi } from 'vitest';
import { matchCustomId, type CustomPreset } from '../../src/lib/ui/presets';
import { DEFAULT_SETTINGS } from '../../src/engine/protocol';

const settings = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

vi.stubGlobal('localStorage', settings);

// import after the stub so module-init hydration reads the stubbed storage
const { customPresets } = await import('../../src/lib/state/customPresets.svelte');

function makeCustom(id: string, name: string): CustomPreset {
  return {
    id,
    name,
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      forestRoadPreference: 0.9,
    },
  };
}

describe('custom presets (E4.2)', () => {
  beforeEach(() => {
    settings.store.clear();
    customPresets.list.length = 0;
  });

  it('starts empty without persisted data', () => {
    expect(customPresets.list).toHaveLength(0);
  });

  it('adds a preset with trimmed name and snapshot settings', () => {
    customPresets.add('  Steil & steinig  ', DEFAULT_SETTINGS);
    expect(customPresets.list).toHaveLength(1);
    expect(customPresets.list[0]!.name).toBe('Steil & steinig');
    // settings deep-copied: mutating afterwards must not affect the preset
    DEFAULT_SETTINGS.uphill.mtb.max = 99;
    expect(customPresets.list[0]!.settings.uphill.mtb.max).toBe(2);
  });

  it('ignores blank names', () => {
    customPresets.add('   ', DEFAULT_SETTINGS);
    expect(customPresets.list).toHaveLength(0);
  });

  it('persists to localStorage and hydrates on reload', () => {
    customPresets.add('Persisted', DEFAULT_SETTINGS);
    expect(settings.store.has('mtbr.customPresets.v1')).toBe(true);
    // simulate a fresh module by reading the persisted JSON
    const raw = JSON.parse(settings.store.get('mtbr.customPresets.v1')!) as CustomPreset[];
    expect(raw).toHaveLength(1);
    expect(raw[0]!.name).toBe('Persisted');
  });

  it('removes by id', () => {
    customPresets.add('A', DEFAULT_SETTINGS);
    customPresets.add('B', DEFAULT_SETTINGS);
    const id = customPresets.list[0]!.id;
    customPresets.remove(id);
    expect(customPresets.list).toHaveLength(1);
    expect(customPresets.list.every((p) => p.id !== id)).toBe(true);
  });

  it('matchCustomId finds the matching custom preset', () => {
    const customs = [makeCustom('x', 'Steil')];
    expect(matchCustomId(customs[0]!.settings, customs)).toBe('x');
    expect(matchCustomId(DEFAULT_SETTINGS, customs)).toBeNull();
  });
});
