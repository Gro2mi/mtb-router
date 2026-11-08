/**
 * Route rendering (E5.1/E5.2): casing + difficulty-colored line per segment
 * (data-driven `line-color`), separate dashed layer for walking-only edges,
 * segment popup on click (also drives the profile highlight), and the profile
 * scrub marker. The camera is never moved here — routes render in place.
 */
import {
  Marker,
  Popup,
  type GeoJSONSource,
  type LngLatLike,
  type Map,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import { i18n } from '../i18n.svelte';
import { profileState } from '../state/profile.svelte';
import { segmentColor, WALKING_COLOR } from './difficultyColors';
import type { RouteResult, RouteSegment } from '../../engine/protocol';

const SOURCE = 'mtbr-route';
const LABEL_SOURCE = 'mtbr-route-labels';
const CASING = 'mtbr-route-casing';
const LINE = 'mtbr-route-line';
const WALK = 'mtbr-route-walk';
const BEELINE = 'mtbr-route-beeline';
const LABEL = 'mtbr-route-difficulty-label';

interface SegmentProps {
  color: string;
  walking: boolean;
  beeline: boolean;
  wayId: number;
  highway: string;
  surface: string;
  difficulty: number;
  tagged: boolean;
  /** trail label: 'S2', 'T3', … (user request — S preferred over T) */
  label: string;
  startM: number;
  endM: number;
}

function segmentProperties(seg: RouteSegment, startM: number, endM: number): SegmentProps {
  return {
    color: segmentColor(seg),
    walking: seg.walking === true,
    beeline: seg.beeline === true,
    wayId: seg.wayId,
    highway: seg.highway,
    surface: seg.surface ?? '',
    difficulty: Math.round(seg.difficulty ?? seg.mtbDown),
    tagged: seg.difficultyTagged === true,
    label: seg.difficultyLabel ?? '',
    startM,
    endM,
  };
}

function popupContent(props: SegmentProps): HTMLElement {
  const container = document.createElement('div');
  container.className = 'mtbr-ui mtbr-segment-popup';

  const row = (label: string, value: string): void => {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${label}:</strong> ${value}`;
    container.appendChild(p);
  };
  row(i18n.m.popup_class(), props.highway);
  row(i18n.m.popup_surface(), props.surface === '' ? i18n.m.popup_none() : props.surface);
  row(
    i18n.m.popup_mtb(),
    `S${props.difficulty} · ${props.tagged ? i18n.m.popup_tagged() : i18n.m.popup_inferred()}`,
  );
  if (props.beeline) {
    const bl = document.createElement('p');
    bl.className = 'mtbr-popup-beeline';
    bl.textContent = i18n.m.popup_beeline();
    container.appendChild(bl);
  } else if (props.walking) {
    const walk = document.createElement('p');
    walk.className = 'mtbr-popup-walk';
    walk.textContent = i18n.m.popup_walking();
    container.appendChild(walk);
  }
  return container;
}

export class RouteLayer {
  private scrubMarker: Marker | null = null;

  constructor(private readonly map: Map) {
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: CASING,
      type: 'line',
      source: SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 },
    });
    map.addLayer({
      id: LINE,
      type: 'line',
      source: SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      filter: ['all', ['!=', ['get', 'walking'], true], ['!=', ['get', 'beeline'], true]],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 5,
      },
    });
    map.addLayer({
      id: WALK,
      type: 'line',
      source: SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      filter: ['all', ['==', ['get', 'walking'], true], ['!=', ['get', 'beeline'], true]],
      paint: {
        'line-color': WALKING_COLOR,
        'line-width': 4,
        'line-dasharray': [2, 2],
      },
    });
    map.addLayer({
      id: BEELINE,
      type: 'line',
      source: SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      filter: ['==', ['get', 'beeline'], true],
      paint: {
        'line-color': '#f59e0b',
        'line-width': 4,
        'line-dasharray': [1.5, 2.5],
      },
    });
    // difficulty labels along the path (user request): 'S2', 'T3' … drawn
    // from a separate source holding CONSECUTIVE SAME-LABEL runs merged into
    // one line feature each — one label per trail stretch instead of one per
    // intersection-split way piece. Beelines (no trail data) stay unlabeled.
    map.addSource(LABEL_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: LABEL,
      type: 'symbol',
      source: LABEL_SOURCE,
      minzoom: 12,
      layout: {
        'symbol-placement': 'line-center',
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-allow-overlap': false,
        'text-padding': 2,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#3f3f46',
        'text-halo-width': 1.6,
      },
    });

    // segment popup + profile highlight (E5.2/E5.3 two-way sync)
    const onSegmentClick = (
      event: MapLayerMouseEvent & { features?: { properties?: Record<string, unknown> }[] },
    ): void => {
      const raw = event.features?.[0]?.properties as SegmentProps | undefined;
      if (!raw) return;
      const props: SegmentProps = {
        ...raw,
        walking: raw.walking === true || (raw.walking as unknown) === 'true',
        beeline: raw.beeline === true || (raw.beeline as unknown) === 'true',
        tagged: raw.tagged === true || (raw.tagged as unknown) === 'true',
      };
      new Popup({ closeButton: false, offset: 12 })
        .setLngLat(event.lngLat)
        .setDOMContent(popupContent(props))
        .addTo(this.map);
      profileState.setHighlight({ startM: props.startM, endM: props.endM });
    };
    map.on('click', LINE, onSegmentClick);
    map.on('click', WALK, onSegmentClick);
    map.on('mouseenter', LINE, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', LINE, () => (map.getCanvas().style.cursor = ''));
  }

  setRoute(route: RouteResult | null): void {
    const source = this.map.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    profileState.reset();
    this.setScrubPoint(null);
    const labelSource = this.map.getSource(LABEL_SOURCE) as GeoJSONSource | undefined;
    if (!route) {
      source.setData({ type: 'FeatureCollection', features: [] });
      labelSource?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const features: {
      type: 'Feature';
      properties: SegmentProps;
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    }[] = [];
    let cum = 0;
    // consecutive same-label segments merge into one line feature (one label
    // per trail stretch — way pieces split at intersections stay unlabeled)
    let run: { label: string; coords: [number, number][] } | null = null;
    const flushRun = (): void => {
      if (run && run.coords.length >= 2) {
        labelFeatures.push({
          type: 'Feature',
          properties: { label: run.label },
          geometry: { type: 'LineString', coordinates: run.coords },
        });
      }
      run = null;
    };
    const labelFeatures: {
      type: 'Feature';
      properties: { label: string };
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    }[] = [];
    for (const leg of route.legs) {
      for (const seg of leg.segments) {
        const [from, to] = seg.coords;
        const fromLL = [from![1]!, from![0]!] as [number, number];
        const toLL = [to![1]!, to![0]!] as [number, number];
        features.push({
          type: 'Feature',
          properties: segmentProperties(seg, cum, cum + seg.distanceM),
          geometry: { type: 'LineString', coordinates: [fromLL, toLL] },
        });
        const label = seg.difficultyLabel;
        if (label && seg.beeline !== true) {
          if (run && run.label === label) run.coords.push(toLL);
          else {
            flushRun();
            run = { label, coords: [fromLL, toLL] };
          }
        } else {
          flushRun();
        }
        cum += seg.distanceM;
      }
    }
    flushRun();
    source.setData({ type: 'FeatureCollection', features });
    labelSource?.setData({ type: 'FeatureCollection', features: labelFeatures });
  }

  /** elevation-profile scrub position rendered as a marker on the route */
  setScrubPoint(lngLat: [number, number] | null): void {
    if (lngLat === null) {
      this.scrubMarker?.remove();
      this.scrubMarker = null;
      return;
    }
    if (!this.scrubMarker) {
      const el = document.createElement('div');
      el.className = 'mtbr-profile-dot mtbr-ui';
      el.setAttribute('aria-hidden', 'true');
      // position BEFORE addTo: maplibre v6 runs Marker._update inside addTo
      // and reads the (unset) lngLat — throwing after the element was appended
      const marker = new Marker({ element: el });
      marker.setLngLat(lngLat as LngLatLike);
      marker.addTo(this.map);
      this.scrubMarker = marker;
    }
    this.scrubMarker.setLngLat(lngLat as LngLatLike);
  }

  destroy(): void {
    this.setScrubPoint(null);
    for (const id of [LABEL, BEELINE, LINE, WALK, CASING]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    for (const id of [SOURCE, LABEL_SOURCE]) {
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
  }
}
