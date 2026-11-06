/**
 * MapLibre setup (E1.2, E1.5): OpenFreeMap Liberty style, controls, and
 * viewport persistence. OpenFreeMap serves free OSM vector tiles without an
 * API key (PLAN §4).
 */
import {
  AttributionControl,
  GeolocateControl,
  Map,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl';
import { DEFAULT_VIEWPORT, loadViewport, saveViewport } from '../state/viewport';
import { NorthControl } from './northControl';

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export interface MapHandle {
  map: Map;
  geolocate: GeolocateControl;
  destroy(): void;
}

export function createMap(container: HTMLElement): MapHandle {
  // maplibre-gl v6 loads its worker via `new URL(..., import.meta.url)`, which
  // breaks under Vite (dev pre-bundling and the production bundle). Point it at
  // the copy in public/vendor, synced by scripts/sync-maplibre-worker.mjs.
  setWorkerUrl(`${import.meta.env.BASE_URL}vendor/maplibre-gl-worker.mjs`);

  const initial = loadViewport(localStorage) ?? DEFAULT_VIEWPORT;

  const map = new Map({
    container,
    style: MAP_STYLE_URL,
    center: initial.center,
    zoom: initial.zoom,
    bearing: initial.bearing,
    pitch: 0, // 2D only (user request) — stored pitch is ignored
    maxPitch: 0, // hard-disables every pitch gesture (drag-rotate, touch)
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: false, // added separately, see below
  });

  // Compact "ⓘ" attribution. Placed top-left because the bottom sheet/drawer
  // covers the bottom edge (TODO E2: use map.setPadding when the sheet opens).
  map.addControl(new AttributionControl({ compact: true }), 'top-left');
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new NorthControl(), 'top-right');

  const geolocate = new GeolocateControl({
    positionOptions: { enableHighAccuracy: true, timeout: 10_000 },
    trackUserLocation: true,
  });
  map.addControl(geolocate, 'top-right');

  const onMoveEnd = (): void => {
    const center = map.getCenter();
    saveViewport(localStorage, {
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    });
  };
  map.on('moveend', onMoveEnd);

  return {
    map,
    geolocate,
    destroy() {
      map.off('moveend', onMoveEnd);
      map.remove();
    },
  };
}
