/**
 * Custom preset persistence (E4.2 leftover): saved rider presets in
 * localStorage. Synchronous like the other small preferences.
 */
import type { CustomPreset } from '../ui/presets';
import type { RiderSettings } from '../../engine/protocol';

const KEY = 'mtbr.customPresets.v1';

function load(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is CustomPreset =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as CustomPreset).id === 'string' &&
        typeof (p as CustomPreset).name === 'string' &&
        typeof (p as CustomPreset).settings === 'object',
    );
  } catch {
    return [];
  }
}

const list = $state<CustomPreset[]>(load());

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify($state.snapshot(list)));
  } catch {
    // private mode — presets won't persist
  }
}

export const customPresets = {
  get list(): CustomPreset[] {
    return list;
  },
  add(name: string, settings: RiderSettings): void {
    const trimmed = name.trim();
    if (trimmed === '') return;
    // JSON deep-clone: $state.snapshot alone can leave nested proxies behind
    // when called from outside a reactive context, and structuredClone throws
    // on them — pure-JSON round-trip is the safe copy here
    const plain = JSON.parse(JSON.stringify(settings)) as RiderSettings;
    list.push({
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `p-${Date.now()}`,
      name: trimmed,
      settings: plain,
    });
    persist();
  },
  remove(id: string): void {
    const idx = list.findIndex((p) => p.id === id);
    if (idx !== -1) list.splice(idx, 1);
    persist();
  },
};
