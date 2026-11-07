import { describe, expect, it } from 'vitest';
import { ownBasemapUrl, rewriteStyleForOwnBasemap } from '../../src/lib/map/ownBasemap';

const style = {
  version: 8,
  name: 'Bright',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    },
    ne2_shaded: {
      type: 'raster',
      tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'],
    },
  },
  layers: [
    { id: 'background', type: 'background' },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
  ],
};

const PMTILES_URL = 'https://mydomain.com/mtb-router/tiles/basemap.pmtiles';

describe('own-basemap style rewrite', () => {
  it('points the vector source at the own PMTiles archive', () => {
    const rewritten = rewriteStyleForOwnBasemap(style, PMTILES_URL) as typeof style;
    expect(rewritten.sources.openmaptiles.url).toBe(`pmtiles://${PMTILES_URL}`);
    expect(rewritten.sources.openmaptiles.type).toBe('vector');
  });

  it('keeps glyphs, raster sources and layers untouched', () => {
    const rewritten = rewriteStyleForOwnBasemap(style, PMTILES_URL) as typeof style;
    expect(rewritten.glyphs).toBe(style.glyphs);
    expect(rewritten.sources.ne2_shaded.tiles).toEqual(style.sources.ne2_shaded.tiles);
    expect(rewritten.layers).toEqual(style.layers);
  });

  it('does not mutate the input style', () => {
    rewriteStyleForOwnBasemap(style, PMTILES_URL);
    expect(style.sources.openmaptiles.url).toBe('https://tiles.openfreemap.org/planet');
  });

  it('survives a style without sources (defensive)', () => {
    expect(() => rewriteStyleForOwnBasemap({ version: 8 }, PMTILES_URL)).not.toThrow();
  });

  it('builds the archive URL from a tile base', () => {
    expect(ownBasemapUrl('https://mydomain.com/mtb-router/tiles')).toBe(
      'https://mydomain.com/mtb-router/tiles/basemap.pmtiles',
    );
    expect(ownBasemapUrl('https://mydomain.com/mtb-router/tiles/')).toBe(
      'https://mydomain.com/mtb-router/tiles/basemap.pmtiles',
    );
  });
});
