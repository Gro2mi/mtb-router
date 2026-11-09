/**
 * Outdoor contrast pass (user request): on top of the Bright style, make
 * every road class clearly visible — tracks get a dedicated dirt-colored
 * layer (stock Bright renders them as white streets), cycleways/bridleways
 * (invisible in stock Bright) get a dashed petrol layer, paths and minor
 * street casings are darkened. All tweaks are guarded so style updates
 * cannot break the app.
 *
 * Style-spec literals are handled as loose JSON and cast only at the
 * MapLibre API boundary — the official types are unusable for runtime
 * filter surgery.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';

const LINE_GEOM = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];

type Json = unknown;

/** Recursively remove a value from literal lists inside match expressions.
 *  Values live in a nested array: ["match", input, [values…], fallback…];
 *  removing the value from that list keeps the outputs intact. */
function removeFromFilter(filter: Json, value: string): Json {
  if (!Array.isArray(filter)) return filter;
  return filter.map((node): Json => {
    if (Array.isArray(node) && node[0] === 'match') {
      const values = node[2];
      if (Array.isArray(values) && values.includes(value)) {
        return [node[0], node[1], values.filter((v) => v !== value), ...node.slice(3)];
      }
    }
    if (Array.isArray(node) && (node[0] === 'all' || node[0] === 'any')) {
      return removeFromFilter(node, value);
    }
    return node;
  });
}

type AddLayerArg = Parameters<MapLibreMap['addLayer']>[0];

export function applyOutdoorContrast(map: MapLibreMap): void {
  try {
    apply(map);
  } catch {
    // style tweaks are cosmetic — never break the map on a style update
  }
}

function apply(map: MapLibreMap): void {
  const pathLayer = map.getLayer('highway-path');
  if (!pathLayer) return; // unexpected style — leave it alone
  const source = pathLayer.source;
  const sourceLayer = pathLayer.sourceLayer ?? 'transportation';
  const beforeId = 'highway-path';

  // 1. tracks: out of the white "minor" streets, into a dirt-colored layer
  if (map.getLayer('highway-minor')) {
    const filter = map.getFilter('highway-minor');
    if (filter) {
      map.setFilter('highway-minor', removeFromFilter(filter, 'track') as FilterSpec);
    }
  }
  if (map.getLayer('highway-minor-casing')) {
    const filter = map.getFilter('highway-minor-casing');
    if (filter) {
      map.setFilter('highway-minor-casing', removeFromFilter(filter, 'track') as FilterSpec);
    }
    map.setPaintProperty('highway-minor-casing', 'line-color', '#9a938c');
    map.setPaintProperty('highway-minor-casing', 'line-width', zoomWidth([14, 4.5, 20, 17]));
  }

  const trackFilter = [
    'all',
    LINE_GEOM,
    ['!=', ['get', 'brunnel'], 'tunnel'],
    ['==', ['get', 'class'], 'track'],
  ];
  map.addLayer(
    {
      id: 'mtbr-track-casing',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      filter: trackFilter,
      paint: {
        'line-color': '#6e4f2f',
        'line-width': zoomWidth([12, 3.5, 20, 13]),
      },
    } as unknown as AddLayerArg,
    beforeId,
  );
  map.addLayer(
    {
      id: 'mtbr-track',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      filter: trackFilter,
      paint: {
        'line-color': '#b07845',
        'line-width': zoomWidth([12, 2, 20, 9.5]),
      },
    } as unknown as AddLayerArg,
    beforeId,
  );

  // 2. cycleways + bridleways: dashed petrol (invisible in stock Bright)
  map.addLayer(
    {
      id: 'mtbr-cycleway',
      type: 'line',
      source,
      'source-layer': sourceLayer,
      filter: [
        'all',
        LINE_GEOM,
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['match', ['get', 'class'], ['cycleway', 'bridleway'], true, false],
      ],
      paint: {
        'line-color': '#0e7c86',
        'line-width': zoomWidth([13, 1.5, 20, 4.5]),
        'line-dasharray': [4, 2.5],
      },
    } as unknown as AddLayerArg,
    beforeId,
  );

  // 3. paths: darker + wider (stock is faint tan)
  map.setPaintProperty('highway-path', 'line-color', '#93805e');
  map.setPaintProperty('highway-path', 'line-width', zoomWidth([15, 1.8, 20, 5.5]));

  // 4. mountain peaks (user request: the most important orientation aid) —
  // stock Bright has NO peak layer at all, even though the tiles carry the
  // full OpenMapTiles mountain_peak source-layer (name + ele + rank). Add a
  // two-line label: name + elevation, from z10 (the tiles themselves thin
  // out low-rank peaks at low zooms, which keeps the overview uncluttered).
  map.addLayer(
    {
      id: 'mtbr-peaks',
      type: 'symbol',
      source,
      'source-layer': 'mountain_peak',
      minzoom: 10,
      filter: ['all', ['has', 'name'], ['!=', ['get', 'class'], 'ridge']],
      layout: {
        'symbol-placement': 'point',
        'text-field': [
          'format',
          ['get', 'name'],
          { 'text-font': ['literal', ['Noto Sans Italic']] },
          '\n',
          {},
          ['to-string', ['get', 'ele']],
          { 'text-font': ['literal', ['Noto Sans Regular']], 'font-scale': 0.85 },
          ' m',
          {},
        ],
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12],
        'text-line-height': 1.15,
        'text-anchor': 'bottom',
        'text-offset': [0, -0.4],
        'text-allow-overlap': false,
        'text-padding': 2,
      },
      paint: {
        'text-color': '#3d3630',
        'text-halo-color': '#f5f3ee',
        'text-halo-width': 1.4,
      },
    } as unknown as AddLayerArg,
    beforeId,
  );
}

type FilterSpec = Parameters<MapLibreMap['setFilter']>[1];
// maplibre's style-spec unions aren't exported; `never` assigns anywhere at this boundary.
// The tuple is [zoom1, width1, zoom2, width2] → wrapped in a zoom-interpolate expression.
const zoomWidth = ([z1, w1, z2, w2]: [number, number, number, number]): never =>
  ['interpolate', ['linear'], ['zoom'], z1, w1, z2, w2] as never;
