/**
 * Contour lines overlay: client-side isolines from AWS Terrain Tiles via the
 * maplibre-contour plugin. The plugin registers a custom protocol with
 * maplibre, decodes terrarium PNGs in a shared worker and serves marching-
 * squares vector tiles — no extra tile hosting needed. Line layers are added
 * BEFORE the route/waypoint layers so routes always paint on top.
 */
import { addProtocol, type Map as MapLibreMap, type LayerSpecification } from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
type DemSource = InstanceType<(typeof mlcontour)['DemSource']>;

const SOURCE = 'mtbr-contours';
const LINE = 'mtbr-contours-line';
const LABEL = 'mtbr-contours-label';
const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

let demSource: DemSource | null = null;

/** thin tan lines that read on both the Bright and the own-basemap style */
const CONTOUR_COLOR = '#8c6d46';
const CONTOUR_MAJOR_COLOR = '#7a5c36';

export class ContourLayer {
  private map: MapLibreMap;
  private destroyed = false;

  constructor(map: MapLibreMap) {
    this.map = map;
    // one protocol registration per page (addProtocol is global on maplibre)
    if (!demSource) {
      demSource = new mlcontour.DemSource({
        url: DEM_URL,
        encoding: 'terrarium',
        maxzoom: 15,
        cacheSize: 128,
        worker: true, // decode off the main thread
      });
      demSource.setupMaplibre({ addProtocol });
    }
    map.addSource(SOURCE, {
      type: 'vector',
      tiles: [
        demSource.contourProtocolUrl({
          multiplier: 1,
          overzoom: 1,
          elevationKey: 'ele',
          levelKey: 'level',
          contourLayer: 'contour',
          // zoom → [minor, major] interval in meters
          thresholds: { 11: [50, 250], 14: [20, 100] },
        }),
      ],
      maxzoom: 15,
      attribution: 'Elevation: Mapzen / AWS Terrain Tiles',
    });
    map.addLayer({
      id: LINE,
      type: 'line',
      source: SOURCE,
      'source-layer': 'contour',
      layout: { visibility: 'none' },
      filter: ['==', ['get', 'level'], 0],
      paint: {
        'line-color': CONTOUR_COLOR,
        'line-opacity': 0.4,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1],
      },
    } as LayerSpecification);
    map.addLayer({
      id: `${LINE}-major`,
      type: 'line',
      source: SOURCE,
      'source-layer': 'contour',
      layout: { visibility: 'none' },
      filter: ['==', ['get', 'level'], 1],
      paint: {
        'line-color': CONTOUR_MAJOR_COLOR,
        'line-opacity': 0.65,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 1.5],
      },
    } as LayerSpecification);
    map.addLayer({
      id: LABEL,
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'contour',
      minzoom: 13,
      layout: {
        visibility: 'none',
        'symbol-placement': 'line',
        'text-field': ['concat', ['get', 'ele'], ' m'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 9,
        'text-offset': [0, -0.9],
      },
      filter: ['==', ['get', 'level'], 1],
      paint: {
        'text-color': CONTOUR_MAJOR_COLOR,
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.2,
      },
    } as LayerSpecification);
  }

  setVisible(visible: boolean): void {
    if (this.destroyed) return;
    const visibility = visible ? 'visible' : 'none';
    for (const id of [LINE, `${LINE}-major`, LABEL]) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visibility);
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const id of [LABEL, `${LINE}-major`, LINE]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
  }
}
