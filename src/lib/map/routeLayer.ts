/**
 * Basic route line rendering (E3.7 minimal slice; difficulty coloring and
 * the elevation profile arrive with E5).
 */
import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { RouteResult } from '../../engine/protocol';

const SOURCE = 'mtbr-route';
const CASING = 'mtbr-route-casing';
const LINE = 'mtbr-route-line';

export class RouteLayer {
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
      paint: { 'line-color': '#ea580c', 'line-width': 5 },
    });
  }

  setRoute(route: RouteResult | null): void {
    const source = this.map.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    if (!route) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    // one LineString per leg; legs chain through the waypoints
    const features = route.legs
      .filter((leg) => leg.segments.length > 0)
      .map((leg) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            leg.segments[0]!.coords[0]!.slice(0, 2).reverse(),
            ...leg.segments.flatMap((s) => s.coords.slice(1).map((c) => c.slice(0, 2).reverse())),
          ],
        },
      }));
    source.setData({ type: 'FeatureCollection', features });
  }

  destroy(): void {
    if (this.map.getLayer(LINE)) this.map.removeLayer(LINE);
    if (this.map.getLayer(CASING)) this.map.removeLayer(CASING);
    if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
  }
}
