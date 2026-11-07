/**
 * Own-basemap mode (user request: "shouldn't I request my own pbf data?"):
 * the OpenFreeMap requests the user sees are the *basemap rendering* tiles of
 * the Bright style — a separate pipeline from the routing corridor data (which
 * already comes from the self-hosted build). This module lets the user replace
 * them with their own PMTiles archive built from the same OSM data
 * (Planetiler, see README "Own basemap tiles").
 *
 * Behavior: if `<tile host>/basemap.pmtiles` exists, the hosted Bright style
 * is loaded and its vector source is rewritten to the PMTiles archive.
 * Otherwise the hosted style is used as-is. Labels/fonts stay on the hosted
 * glyphs endpoint (a few small requests).
 */
import { Protocol } from 'pmtiles';
import { addProtocol, type RequestParameters } from 'maplibre-gl';

let protocolRegistered = false;

/** Register the pmtiles:// protocol with MapLibre (idempotent). */
export function registerPmtilesProtocol(): void {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  // pmtiles v4's handler is maplibre-compatible; cast only at the boundary
  addProtocol('pmtiles', ((params: RequestParameters, abortController: AbortController) =>
    protocol.tile(params, abortController)) as unknown as Parameters<typeof addProtocol>[1]);
  protocolRegistered = true;
}

export const BASEMAP_FILE = 'basemap.pmtiles';

/** Absolute URL of the own-basemap archive for a resolved tile base. */
export function ownBasemapUrl(tileBase: string): string {
  return `${tileBase.replace(/\/+$/, '')}/${BASEMAP_FILE}`;
}

/**
 * Rewrite a style so its vector source reads from the own PMTiles archive.
 * Pure: returns a deep-cloned style, the input is not mutated. Everything
 * except vector-source URLs (glyphs, sprites, raster sources, layers) is kept
 * untouched, and OSM attribution stays intact.
 */
export function rewriteStyleForOwnBasemap(
  style: unknown,
  pmtilesUrl: string,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(style)) as Record<string, unknown>;
  const sources = (clone['sources'] ?? {}) as Record<
    string,
    { type?: string; url?: string; tiles?: string[] }
  >;
  const pmtilesSourceUrl = `pmtiles://${pmtilesUrl}`;
  for (const source of Object.values(sources)) {
    if (source?.type === 'vector' && typeof source.url === 'string') {
      source.url = pmtilesSourceUrl;
    }
  }
  return clone;
}

/**
 * Probe for the own-basemap archive on a resolved tile host.
 * Returns its absolute URL, or null when absent/unreachable.
 */
export async function probeOwnBasemap(
  tileBase: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = ownBasemapUrl(tileBase);
  try {
    const res = await fetch(url, { method: 'HEAD', signal });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}
