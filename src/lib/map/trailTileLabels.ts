/**
 * Trail difficulty labels straight from the self-hosted routing tiles
 * (user request: label ALL trails, S preferred over T, without clutter).
 *
 * The corridor tiles (build-tiles v2) carry full OSM tags per way, so the
 * viewport's tiles can be fetched (SW-cached, already warm from routing) and
 * every tagged trail gets a chip label — no second archive needed. Active
 * only from z14 (below that, orientation comes from the peak labels and the
 * density would be unreadable), collision-handled, and T1 trails are skipped
 * (the trivial hiking default — labeling it everywhere is noise). When the
 * higher-quality trails.pmtiles overlay is active, this layer stays off.
 *
 * Pure decision logic (`trailLabelFromTags`) is exported for tests.
 */
import {
  corridorTileRange,
  tilesInRange,
  type TileRange,
} from '../osm/staticTiles';
import type { Map as MapLibreMap, LayerSpecification } from 'maplibre-gl';

const SOURCE = 'mtbr-trail-tiles';
const LABEL = 'mtbr-trail-tiles-label';
const LABEL_ZOOM = 14;
const MAX_FEATURES = 800;
const TRAIL_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'cycleway']);

const SAC_NAMES: Record<string, string> = {
  hiking: '', // T1 — the trivial default, skipped to keep the map uncluttered
  mountain_hiking: 'T2',
  demanding_mountain_hiking: 'T3',
  alpine_hiking: 'T4',
  demanding_alpine_hiking: 'T5',
  difficult_alpine_hiking: 'T6',
};

/** S-over-T label for a way's raw tags, or null when it should not be labeled. */
export function trailLabelFromTags(tags: Record<string, string>): string | null {
  const mtb = tags['mtb:scale'] ?? tags['mtb:scale:uphill'];
  if (mtb !== undefined) return `S${mtb}`;
  const sac = tags['sac_scale'];
  if (sac === undefined) return null;
  if (SAC_NAMES[sac] !== undefined) return SAC_NAMES[sac] || null;
  // non-standard value (e.g. numeric 'T3') — keep verbatim when meaningful
  return /^T[2-6]$/.test(sac) ? sac : null;
}

/** sort key: S labels win contested space over T labels (maplibre places low first) */
function sortKeyOf(label: string): number {
  return label.startsWith('S') ? 0 : 1;
}

type TileJson = { w: [number, [number, number][], Record<string, string>][] };

export class TrailTileLabels {
  private map: MapLibreMap;
  private tileBase: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | null = null;
  private lastKey = '';
  private destroyed = false;

  constructor(map: MapLibreMap) {
    this.map = map;
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: LABEL,
      type: 'symbol',
      source: SOURCE,
      minzoom: LABEL_ZOOM,
      layout: {
        'symbol-placement': 'line-center',
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 9,
        'text-allow-overlap': false,
        'text-padding': 4,
        'symbol-sort-key': ['get', 'sort'],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#5d4a2f',
        'text-halo-width': 1.4,
      },
    } as LayerSpecification);
    map.on('moveend', this.onMoveEnd);
  }

  setTileBase(base: string | null): void {
    if (base === this.tileBase) return;
    this.tileBase = base;
    this.lastKey = '';
    this.onMoveEnd();
  }

  private onMoveEnd = (): void => {
    if (this.destroyed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.update(), 400);
  };

  private async update(): Promise<void> {
    if (this.destroyed) return;
    const source = this.map.getSource(SOURCE);
    if (!source) return;
    const zoom = this.map.getZoom();
    if (!this.tileBase || zoom < LABEL_ZOOM - 1) {
      this.lastKey = '';
      this.clear();
      return;
    }
    const b = this.map.getBounds();
    const range: TileRange | null = corridorTileRange(
      [
        [b.getWest(), b.getSouth()],
        [b.getEast(), b.getNorth()],
      ],
      0,
    );
    const key = range ? `${range.x0}_${range.y0}_${range.x1}_${range.y1}` : 'x';
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    const keys = range ? tilesInRange(range) : [];
    const byWayId = new Map<number, GeoJSON.Feature>();
    for (const tileKeyStr of keys) {
      if (controller.signal.aborted) return;
      let json: TileJson;
      try {
        const res = await fetch(`${this.tileBase}/${tileKeyStr}.json`, {
          signal: controller.signal,
        });
        if (!res.ok) continue;
        json = (await res.json()) as TileJson;
      } catch {
        if (controller.signal.aborted) return;
        continue; // region edge / lake tile — nothing to label
      }
      for (const way of json.w ?? []) {
        const [wayId, coords, tags] = way;
        if (byWayId.has(wayId)) continue;
        if (!TRAIL_HIGHWAYS.has(tags['highway'] ?? '')) continue;
        const label = trailLabelFromTags(tags);
        if (!label) continue;
        if (byWayId.size >= MAX_FEATURES) return;
        byWayId.set(wayId, {
          type: 'Feature',
          properties: { label, sort: sortKeyOf(label) },
          geometry: {
            type: 'LineString',
            coordinates: coords.map(([lat, lng]) => [lng, lat]),
          },
        });
      }
    }
    if (controller.signal.aborted) return;
    const geo = this.map.getSource(SOURCE) as import('maplibre-gl').GeoJSONSource | undefined;
    geo?.setData({ type: 'FeatureCollection', features: [...byWayId.values()] });
  }

  private clear(): void {
    const geo = this.map.getSource(SOURCE) as import('maplibre-gl').GeoJSONSource | undefined;
    geo?.setData({ type: 'FeatureCollection', features: [] });
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.abort?.abort();
    if (this.map.getLayer(LABEL)) this.map.removeLayer(LABEL);
    if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
  }
}

// minimal structural type — avoids importing the full GeoJSON namespace
declare namespace GeoJSON {
  interface Feature {
    type: 'Feature';
    properties: { label: string; sort: number };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }
}
