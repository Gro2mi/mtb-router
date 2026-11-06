import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEWPORT,
  VIEWPORT_STORAGE_KEY,
  loadViewport,
  saveViewport,
  type StorageLike,
  type Viewport,
} from '../../src/lib/state/viewport';

function memoryStorage(): StorageLike & { dump(): Map<string, string> } {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    dump: () => store,
  };
}

describe('viewport persistence', () => {
  it('round-trips a viewport through storage', () => {
    const storage = memoryStorage();
    const viewport: Viewport = { center: [11.123, 47.654], zoom: 12.5, bearing: -30, pitch: 45 };

    saveViewport(storage, viewport);

    expect(storage.dump().has(VIEWPORT_STORAGE_KEY)).toBe(true);
    expect(loadViewport(storage)).toEqual(viewport);
  });

  it('returns null when nothing is stored', () => {
    expect(loadViewport(memoryStorage())).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    const storage = memoryStorage();
    storage.setItem(VIEWPORT_STORAGE_KEY, '{not json');
    expect(loadViewport(storage)).toBeNull();
  });

  it('returns null when the shape is invalid', () => {
    const storage = memoryStorage();
    storage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify({ center: [1, 2], zoom: 'high' }));
    expect(loadViewport(storage)).toBeNull();
    storage.setItem(
      VIEWPORT_STORAGE_KEY,
      JSON.stringify({ center: [1], zoom: 5, bearing: 0, pitch: 0 }),
    );
    expect(loadViewport(storage)).toBeNull();
  });

  it('rejects non-finite numbers', () => {
    const storage = memoryStorage();
    storage.setItem(VIEWPORT_STORAGE_KEY, '{"center":[1,null],"zoom":5,"bearing":0,"pitch":0}');
    expect(loadViewport(storage)).toBeNull();
  });

  it('overwrites the previous viewport', () => {
    const storage = memoryStorage();
    saveViewport(storage, DEFAULT_VIEWPORT);
    const next: Viewport = { center: [9.5, 51.2], zoom: 10, bearing: 0, pitch: 0 };
    saveViewport(storage, next);
    expect(loadViewport(storage)).toEqual(next);
  });

  it('does not throw when storage rejects writes', () => {
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    expect(() => saveViewport(failing, DEFAULT_VIEWPORT)).not.toThrow();
  });
});
