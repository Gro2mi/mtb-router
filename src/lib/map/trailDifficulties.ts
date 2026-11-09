/**
 * Trail difficulty overlay (user request: label every displayed trail with
 * its S/T grade): when `trails.pmtiles` — a tiny planetiler generate-custom
 * archive, see scripts/build-basemap/trails.yml and the README — is hosted
 * next to the corridor tiles, an overlay source is added that carries a
 * ready-made `trail_label` ('S2', 'T3', …) per tagged trail. Independent of
 * the own-basemap option: it composes with the hosted OpenFreeMap display
 * too. The archive is absent → no overlay (hosted display stays untouched).
 */
import { registerPmtilesProtocol } from './ownBasemap';
import type { Map as MapLibreMap, LayerSpecification } from 'maplibre-gl';

export const TRAILS_FILE = 'trails.pmtiles';

const SOURCE = 'mtbr-trail-diff';
const LINE = 'mtbr-trail-diff-line';
const LABEL = 'mtbr-trail-diff-label';

/** Absolute URL of the trail overlay archive for a resolved tile base. */
export function trailsUrl(tileBase: string): string {
  return `${tileBase.replace(/\/+$/, '')}/${TRAILS_FILE}`;
}

/**
 * Probe for the trail overlay archive (same contract as the own-basemap
 * probe: 206 + PMTiles magic — SPA fallbacks answer 200 + HTML, and PMTiles
 * needs range support anyway). Returns the archive URL or null.
 */
export async function probeTrails(tileBase: string, signal?: AbortSignal): Promise<string | null> {
  const url = trailsUrl(tileBase);
  try {
    const res = await fetch(url, { signal, headers: { Range: 'bytes=0-511' } });
    if (res.status !== 206) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 8 || bytes[0] !== 0x50 || bytes[1] !== 0x4d) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Add the overlay when the archive exists. Layers render BELOW the route
 * (registered in createMap's load handler before App adds the route layers):
 * a faint dark-tan casing marks which trails carry a label, and white chips
 * (same style as the route difficulty labels) show the grade.
 */
export async function initTrailDifficulties(map: MapLibreMap, tileBase: string): Promise<void> {
  const url = await probeTrails(tileBase);
  if (!url) return;
  registerPmtilesProtocol();
  map.addSource(SOURCE, {
    type: 'vector',
    url: `pmtiles://${url}`,
    attribution:
      '<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap contributors</a>',
  });
  map.addLayer({
    id: LINE,
    type: 'line',
    source: SOURCE,
    'source-layer': 'trail_difficulty',
    minzoom: 12,
    paint: {
      'line-color': '#5d4a2f',
      'line-opacity': 0.35,
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 16, 1.6],
    },
  } as LayerSpecification);
  map.addLayer({
    id: LABEL,
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'trail_difficulty',
    minzoom: 13,
    layout: {
      'symbol-placement': 'line-center',
      'text-field': ['get', 'trail_label'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 9,
      'text-allow-overlap': false,
      'text-padding': 3,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': '#5d4a2f',
      'text-halo-width': 1.4,
    },
  } as LayerSpecification);
}

export function removeTrailDifficulties(map: MapLibreMap): void {
  for (const id of [LABEL, LINE]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}
