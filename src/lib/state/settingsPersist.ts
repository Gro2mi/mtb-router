/**
 * Rider settings persistence (E6.3): localStorage like the other small
 * preferences (locale, viewport, snap radius) — synchronous hydration at
 * module init avoids a double worker plan on startup. Epic §6.3 said the
 * IndexedDB `settings` store; deviation recorded in EPICS.md.
 */
import { DEFAULT_SETTINGS, type RiderSettings } from '../../engine/protocol';

const SETTINGS_KEY = 'mtbr.riderSettings.v1';

export function loadRiderSettings(): RiderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<RiderSettings>;
    return validateSettings(parsed) ? (parsed as RiderSettings) : structuredClone(DEFAULT_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveRiderSettings(settings: RiderSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // private mode — settings won't persist
  }
}

function validateSettings(v: Partial<RiderSettings>): boolean {
  const bands = [v.uphill, v.downhill];
  if (bands.some((b) => !b || typeof b !== 'object')) return false;
  for (const b of bands as NonNullable<Partial<RiderSettings>['uphill']>[]) {
    for (const range of [b.mtb, b.sac]) {
      if (!range || typeof range.min !== 'number' || typeof range.max !== 'number') return false;
    }
  }
  return (
    typeof v.forestRoadPreference === 'number' && typeof v.avoidUntaggedSingletrail === 'boolean'
  );
}
