/**
 * Map viewport persistence (E1.2): the last map view survives reloads.
 * Pure module with an injected storage to keep it unit-testable.
 */
export interface Viewport {
  center: [number, number]; // [lng, lat]
  zoom: number;
  bearing: number;
  pitch: number;
}

/** Roughly central Europe with the Alps visible (PLAN E1.2 "initial view Europe"). */
export const DEFAULT_VIEWPORT: Viewport = {
  center: [10.2, 49.9],
  zoom: 5.4,
  bearing: 0,
  pitch: 0,
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const VIEWPORT_STORAGE_KEY = 'mtbr.viewport.v1';

function isValidViewport(v: unknown): v is Viewport {
  if (typeof v !== 'object' || v === null) return false;
  const candidate = v as Partial<Viewport>;
  const { center, zoom, bearing, pitch } = candidate;
  return (
    Array.isArray(center) &&
    center.length === 2 &&
    center.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    typeof zoom === 'number' &&
    Number.isFinite(zoom) &&
    typeof bearing === 'number' &&
    Number.isFinite(bearing) &&
    typeof pitch === 'number' &&
    Number.isFinite(pitch)
  );
}

export function saveViewport(storage: StorageLike, viewport: Viewport): void {
  try {
    storage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(viewport));
  } catch {
    // private mode / quota exceeded — not worth failing over
  }
}

export function loadViewport(storage: StorageLike): Viewport | null {
  try {
    const raw = storage.getItem(VIEWPORT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidViewport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
