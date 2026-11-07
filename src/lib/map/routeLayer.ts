/**
 * Route rendering (E5.1/E5.2): casing + difficulty-colored line per segment
 * (data-driven `line-color`), separate dashed layer for walking-only edges,
 * segment popup on click (also drives the profile highlight), zoom-to-fit on
 * worker-produced routes, and the profile scrub marker.
 */
import {
  LngLatBounds,
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
const CASING = 'mtbr-route-casing';
const LINE = 'mtbr-route-line';
const WALK = 'mtbr-route-walk';

interface SegmentProps {
  color: string;
  walking: boolean;
  wayId: number;
  highway: string;
  surface: string;
  difficulty: number;
  tagged: boolean;
  startM: number;
  endM: number;
}

function segmentProperties(seg: RouteSegment, startM: number, endM: number): SegmentProps {
  return {
    color: segmentColor(seg),
    walking: seg.walking === true,
    wayId: seg.wayId,
    highway: seg.highway,
    surface: seg.surface ?? '',
    difficulty: Math.round(seg.difficulty ?? seg.mtbDown),
    tagged: seg.difficultyTagged === true,
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
  if (props.walking) {
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
      filter: ['!=', ['get', 'walking'], true],
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
      filter: ['==', ['get', 'walking'], true],
      paint: {
        'line-color': WALKING_COLOR,
        'line-width': 4,
        'line-dasharray': [2, 2],
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
    if (!route) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const features: {
      type: 'Feature';
      properties: SegmentProps;
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    }[] = [];
    let cum = 0;
    for (const leg of route.legs) {
      for (const seg of leg.segments) {
        const [from, to] = seg.coords;
        features.push({
          type: 'Feature',
          properties: segmentProperties(seg, cum, cum + seg.distanceM),
          geometry: {
            type: 'LineString',
            coordinates: [
              [from![1]!, from![0]!] as [number, number],
              [to![1]!, to![0]!] as [number, number],
            ],
          },
        });
        cum += seg.distanceM;
      }
    }
    source.setData({ type: 'FeatureCollection', features });
  }

  /** zoom-to-fit for freshly computed routes (skipped when reduced motion) */
  fitToRoute(route: RouteResult): void {
    const bounds = new LngLatBounds();
    for (const leg of route.legs) {
      for (const seg of leg.segments) {
        for (const [lat, lng] of seg.coords) {
          bounds.extend([lng, lat]);
        }
      }
    }
    if (bounds.isEmpty()) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.map.fitBounds(bounds, { padding: 70, maxZoom: 16, linear: true, animate: !reduced });
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
    for (const id of [LINE, WALK, CASING]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
  }
}
