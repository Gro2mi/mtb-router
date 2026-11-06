/**
 * Viewport access via the map test seam (E6): capture for route saving and
 * restore (flyTo) for route loading. Isolated so the UI store stays
 * testable without a real map.
 */
import type { Viewport } from '../state/viewport';

interface MapLike {
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
  flyTo(options: { center: [number, number]; zoom: number; bearing: number; pitch: number }): void;
}

function map(): MapLike | null {
  return ((window as unknown as Record<string, unknown>).__mtbrMap as MapLike | undefined) ?? null;
}

export function currentViewport(): Viewport | null {
  const m = map();
  if (!m) return null;
  const center = m.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: m.getZoom(),
    bearing: m.getBearing(),
    pitch: m.getPitch(),
  };
}

export function flyToViewport(viewport: Viewport): void {
  map()?.flyTo({
    center: viewport.center,
    zoom: viewport.zoom,
    bearing: viewport.bearing,
    pitch: viewport.pitch,
  });
}
