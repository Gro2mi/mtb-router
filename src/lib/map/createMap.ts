/**
 * MapLibre setup (E1.2, E1.5): OpenFreeMap Bright style (high-contrast
 * outdoor/cycling map with an extra road-visibility pass), controls, and
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
import { applyOutdoorContrast } from './outdoorContrast';
import { registerPmtilesProtocol, probeOwnBasemap, rewriteStyleForOwnBasemap } from './ownBasemap';
import { resolveTileBaseUrl } from '../osm/staticTiles';

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

export interface MapHandle {
  map: Map;
  geolocate: GeolocateControl;
  destroy(): void;
}

export function createMap(container: HTMLElement): MapHandle {
  // PMTiles support for the own-basemap mode (README: own basemap tiles)
  registerPmtilesProtocol();

  // maplibre-gl v6 loads its worker via `new URL(..., import.meta.url)`, which
  // breaks under Vite (dev pre-bundling and the production bundle). Point it at
  // the copy in public/vendor, synced by scripts/sync-maplibre-worker.mjs.
  // Page-relative: works at the domain root AND in any subfolder deploy
  // (the page URL carries the folder, so relative resolution is correct).
  setWorkerUrl(new URL('vendor/maplibre-gl-worker.mjs', location.href).href);

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

  // Compact "ⓘ" attribution, bottom-left (kept above the bottom sheet on
  // phones via CSS). Legal note: collapsing to a persistent, clickable chip
  // is fine — the credits stay one tap away and are also listed in the sheet
  // footer; hiding them entirely would violate the ODbL/OSMF guideline that
  // attribution must stay visible.
  map.addControl(new AttributionControl({ compact: true }), 'bottom-left');
  // maplibre v6 starts the compact control EXPANDED; collapse it right away
  // (user request) — the chip stays visible and opens on tap, which keeps the
  // ODbL/OSMF requirement of visible, accessible attribution. The style
  // credits populate after 'load', so wait for the element to exist first;
  // removing compact-show is stable because maplibre only adds it once, when
  // the compact state is created.
  map.once('load', () => {
    let tries = 0;
    const wait = setInterval(() => {
      const el = map
        .getContainer()
        .querySelector<HTMLElement>('.maplibregl-ctrl-attrib.maplibregl-compact');
      if (el) {
        clearInterval(wait);
        el.classList.remove('maplibregl-compact-show');
      } else if (++tries > 40) {
        clearInterval(wait);
      }
    }, 100);
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new NorthControl(), 'top-right');

  // dev console/probe access (E7.2-style instrumentation, no-op in prod builds)
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__mtbrMap = map;
  }

  const geolocate = new GeolocateControl({
    positionOptions: { enableHighAccuracy: true, timeout: 10_000 },
    trackUserLocation: true,
  });
  map.addControl(geolocate, 'top-right');

  // high-visibility roads (tracks/cycleways are nearly invisible in stock Bright)
  map.on('load', () => applyOutdoorContrast(map));

  // own-basemap mode: when basemap.pmtiles exists on the tile host, swap the
  // hosted OpenFreeMap vector source for the own archive (README: own basemap)
  map.on('load', async () => {
    try {
      const tileBase = await resolveTileBaseUrl();
      if (!tileBase) return;
      const basemap = await probeOwnBasemap(tileBase);
      if (!basemap) return;
      const res = await fetch(MAP_STYLE_URL);
      const hosted = await res.json();
      map.setStyle(
        rewriteStyleForOwnBasemap(hosted, basemap) as Parameters<typeof map.setStyle>[0],
        {
          diff: false,
        },
      );
    } catch {
      // basemap swap is cosmetic — keep the hosted style on any failure
    }
  });

  // test seam: lets e2e inspect map layers without a component handle
  (window as unknown as Record<string, unknown>).__mtbrMap = map;

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
