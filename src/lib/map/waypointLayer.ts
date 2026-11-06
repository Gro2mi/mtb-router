/**
 * Waypoint map layer (E2.6): numbered draggable markers (start/end/via),
 * insert-via midpoint handles, delete popup, rubber-band line during live
 * re-snapping. Markers carry the `mtbr-ui` class so map-tap classification
 * ignores interactions with them.
 */
import {
  Marker,
  Popup,
  type GeoJSONSource,
  type LngLatLike,
  type Map as MapLibreMap,
} from 'maplibre-gl';
import { i18n } from '../i18n.svelte';
import { displayPosition, roleOf, type Waypoint } from '../waypoints/store.svelte';
import type { SnapResult } from '../osm/snapIndex';

export interface LayerCallbacks {
  onDelete(id: string): void;
  /** commit a drag (creates undo entry) */
  onMove(id: string, lng: number, lat: number): void;
  /** live snap probe during drag (async since E3 — see onProbeResult) */
  onSnapProbe(id: string, lng: number, lat: number): void;
  onInsertAt(index: number, lng: number, lat: number): void;
}

const RUBBER_SOURCE = 'mtbr-rubber';
const RUBBER_LAYER = 'mtbr-rubber-line';
const THROTTLE_MS = 80;

function isUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.mtbr-ui');
}

function waypointElement(wp: Waypoint, index: number, total: number): HTMLDivElement {
  const role = roleOf(index, total);
  const el = document.createElement('div');
  el.className = 'mtbr-waypoint mtbr-ui';
  el.dataset.role = role ?? 'via';
  el.dataset.snapped = wp.snap ? 'true' : 'false';
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute(
    'aria-label',
    `${i18n.m.waypoint_label({ n: index + 1 })}${wp.snap ? '' : ` — ${i18n.m.unsnapped_note()}`}`,
  );
  if (!wp.snap) el.title = i18n.m.unsnapped_note();
  const num = document.createElement('span');
  num.className = 'mtbr-waypoint-num';
  num.textContent = String(index + 1);
  el.appendChild(num);
  return el;
}

export class WaypointLayer {
  private readonly markers = new Map<string, Marker>();
  private handles: Marker[] = [];
  private popup: Popup | null = null;
  private draggingId: string | null = null;

  constructor(
    private readonly map: MapLibreMap,
    private readonly cb: LayerCallbacks,
  ) {
    map.addSource(RUBBER_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: RUBBER_LAYER,
      type: 'line',
      source: RUBBER_SOURCE,
      paint: {
        'line-color': '#f59e0b',
        'line-width': 2,
        'line-dasharray': [2, 2],
      },
    });
  }

  /** Rebuild markers + handles from the current waypoint list. */
  sync(list: Waypoint[]): void {
    this.popup?.remove();
    this.popup = null;

    for (const marker of this.markers.values()) marker.remove();
    this.markers.clear();
    for (const handle of this.handles) handle.remove();
    this.handles = [];

    // insert-via handles are created FIRST so waypoint markers stack above
    // them (MapLibre markers carry no z-index; stacking is DOM order) — the
    // explicit z-index classes in app.css back this up.
    for (let i = 0; i + 1 < list.length; i++) {
      const a = displayPosition(list[i]!);
      const b = displayPosition(list[i + 1]!);
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const handleEl = document.createElement('div');
      handleEl.className = 'mtbr-insert mtbr-ui';
      handleEl.setAttribute('role', 'button');
      handleEl.setAttribute('tabindex', '0');
      handleEl.setAttribute('aria-label', i18n.m.insert_via_here());
      handleEl.title = i18n.m.insert_via_here();
      const plus = document.createElement('span');
      plus.textContent = '+';
      handleEl.appendChild(plus);
      const handle = new Marker({ element: handleEl, draggable: false })
        .setLngLat(mid)
        .addTo(this.map);
      const insertIndex = i + 1;
      handleEl.addEventListener('click', (event) => {
        event.stopPropagation();
        this.cb.onInsertAt(insertIndex, mid[0], mid[1]);
      });
      handleEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          this.cb.onInsertAt(insertIndex, mid[0], mid[1]);
        }
      });
      this.handles.push(handle);
    }

    // numbered waypoints on top
    list.forEach((wp, index) => {
      const element = waypointElement(wp, index, list.length);
      const marker = new Marker({ element, draggable: true })
        .setLngLat(displayPosition(wp) as LngLatLike)
        .addTo(this.map);
      this.wireMarker(marker, element, wp.id);
      this.markers.set(wp.id, marker);
    });
  }

  private wireMarker(marker: Marker, element: HTMLDivElement, id: string): void {
    let lastProbe = 0;

    element.addEventListener('click', (event) => {
      event.stopPropagation();
      this.showDeletePopup(id, marker);
    });
    // right-click deletes directly (touch long-press is handled by the map gesture layer)
    element.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cb.onDelete(id);
    });
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        this.cb.onDelete(id);
      }
    });

    marker.on('drag', () => {
      const now = performance.now();
      if (now - lastProbe < THROTTLE_MS) return;
      lastProbe = now;
      const lngLat = marker.getLngLat();
      this.draggingId = id;
      this.cb.onSnapProbe(id, lngLat.lng, lngLat.lat);
    });
    marker.on('dragend', () => {
      this.draggingId = null;
      this.setRubber(null);
      const lngLat = marker.getLngLat();
      this.cb.onMove(id, lngLat.lng, lngLat.lat);
    });
  }

  /**
   * Result of an async snap probe (E3 worker round-trip). Updates the rubber
   * band only when the same marker is still being dragged.
   */
  onProbeResult(id: string, snap: SnapResult | null, rawLng: number, rawLat: number): void {
    if (this.draggingId !== id) return;
    const marker = this.markers.get(id);
    if (!marker) return;
    const el = marker.getElement();
    el.dataset.snapped = snap ? 'true' : 'false';
    this.setRubber(
      snap
        ? [
            [rawLng, rawLat],
            [snap.lng, snap.lat],
          ]
        : null,
    );
  }

  private showDeletePopup(id: string, marker: Marker): void {
    this.popup?.remove();
    const content = document.createElement('div');
    content.className = 'mtbr-ui mtbr-delete-popup';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mtbr-delete-button';
    button.textContent = i18n.m.delete_waypoint();
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.cb.onDelete(id);
    });
    content.appendChild(button);
    this.popup = new Popup({ closeOnClick: true, closeButton: false, offset: 24 })
      .setLngLat(marker.getLngLat())
      .setDOMContent(content)
      .addTo(this.map);
  }

  setRubber(line: [number, number][] | null): void {
    const source = this.map.getSource(RUBBER_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(
      line && line.length === 2
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: line },
              },
            ],
          }
        : { type: 'FeatureCollection', features: [] },
    );
  }

  destroy(): void {
    this.popup?.remove();
    for (const marker of this.markers.values()) marker.remove();
    for (const handle of this.handles) handle.remove();
    if (this.map.getLayer(RUBBER_LAYER)) this.map.removeLayer(RUBBER_LAYER);
    if (this.map.getSource(RUBBER_SOURCE)) this.map.removeSource(RUBBER_SOURCE);
  }
}

export { isUiTarget };
