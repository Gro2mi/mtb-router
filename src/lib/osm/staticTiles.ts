/**
 * Self-hosted static tile provider: serves prebuilt corridor data (routable
 * OSM ways + nodes) from plain static hosting — e.g. IONOS webspace — built
 * with scripts/build-tiles. Tried before Overpass in the corridor chain
 * (PLAN §3 "prebuilt graph tiles"); missing tiles (region not built) fall
 * through to the Overpass → OSM API chain. The same tile format feeds the E3
 * graph builder.
 */
import { parseWayTags, isRoutable } from './tags';
import type { WaysBundle } from './overpass';

const TILE_BASE_KEY = 'mtbr.tileBaseUrl.v1';
export const TILE_FORMAT_VERSION = 2;
/** Tile edge in degrees (~11 km × 7.4 km at 47° lat). Must match the builder. */
export const TILE_DEG = 0.1;
/** Request budget per corridor (very long routes degrade to Overpass). */
const MAX_TILES = 64;
const CONCURRENCY = 6;

/**
 * Worker contexts have no localStorage — the host injects the configured URL
 * over the engine protocol. `undefined` = follow localStorage (main thread).
 */
let baseUrlOverride: string | null | undefined = undefined;

export function setTileBaseUrlOverride(value: string | null | undefined): void {
  baseUrlOverride = value;
}

export function getTileBaseUrl(): string | null {
  if (baseUrlOverride !== undefined) return baseUrlOverride;
  try {
    const url = localStorage.getItem(TILE_BASE_KEY);
    if (!url) return null;
    const normalized = url.trim().replace(/\/+$/, '');
    return normalized.startsWith('http') ? normalized : null;
  } catch {
    return null;
  }
}

export function setTileBaseUrl(url: string): void {
  resolvedBase = undefined; // re-resolve on the next corridor (override may have changed)
  clearSessionTileCaches(); // a new host invalidates cached tiles/tombstones
  try {
    const normalized = url.trim().replace(/\/+$/, '');
    if (normalized === '') localStorage.removeItem(TILE_BASE_KEY);
    else localStorage.setItem(TILE_BASE_KEY, normalized);
  } catch {
    // private mode — setting won't persist
  }
}

/**
 * Auto-discovery (user request): probe for a tiles folder next to the app —
 * app-relative (`tiles`, `mtb-tiles`) and domain-root (`/tiles`, `/mtb-tiles`).
 * A folder counts when its manifest.json matches the expected format.
 */
const AUTO_CANDIDATES = ['tiles', 'mtb-tiles', '/tiles', '/mtb-tiles'];

/** Resolved base for this session: undefined = not probed yet, null = none found. */
let resolvedBase: string | null | undefined = undefined;

function origin(): string {
  try {
    return window.location.origin;
  } catch {
    return '';
  }
}

function appBase(): string {
  return import.meta.env.BASE_URL ?? '/';
}

/** Candidate URLs, app-relative first, then domain-root. */
export function autoTileCandidates(): string[] {
  const o = origin();
  return AUTO_CANDIDATES.map((c) =>
    c.startsWith('/') ? `${o}${c}` : `${o}${appBase() === '/' ? '/' : appBase()}${c}`,
  );
}

async function probeCandidate(base: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const manifest = (await fetchJson(`${base}/manifest.json`, signal)) as TileManifest;
    return manifest.formatVersion === TILE_FORMAT_VERSION && manifest.tileDeg === TILE_DEG;
  } catch {
    return false;
  }
}

/**
 * Resolve the tile base URL for this session: the explicit setting wins,
 * otherwise candidates on the same domain are probed once (a valid
 * manifest.json = tiles found). Result is cached for the session; changing
 * the setting re-resolves.
 */
export async function resolveTileBaseUrl(signal?: AbortSignal): Promise<string | null> {
  if (resolvedBase !== undefined) return resolvedBase;
  const explicit = getTileBaseUrl();
  if (explicit) {
    resolvedBase = explicit;
    return resolvedBase;
  }
  for (const candidate of autoTileCandidates()) {
    if (await probeCandidate(candidate, signal)) {
      console.info(`[tiles] auto-discovered tile host at ${candidate}`);
      resolvedBase = candidate;
      return resolvedBase;
    }
  }
  resolvedBase = null;
  return null;
}

/** test hook: forget the session resolution and all session caches */
export function resetTileResolution(): void {
  resolvedBase = undefined;
  clearSessionTileCaches();
}

/**
 * Session caches (per worker instance): parsed tiles, 404 tombstones and the
 * validated manifest. Growing a polyline only fetches the newly-covered
 * tiles, and repeated corridors skip parsing entirely.
 */
const sessionTiles = new Map<string, unknown>();
const sessionMissing = new Set<string>();
let sessionManifest: TileManifest | null | undefined = undefined;

function clearSessionTileCaches(): void {
  sessionTiles.clear();
  sessionMissing.clear();
  sessionManifest = undefined;
}

export interface TileRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Tiles covering the padded polyline bbox (pure); null when over budget. */
export function corridorTileRange(
  points: [number, number][],
  radiusDeg: number,
  tileDeg = TILE_DEG,
): TileRange | null {
  if (points.length === 0) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const x0 = Math.floor((minLng - radiusDeg) / tileDeg);
  const x1 = Math.floor((maxLng + radiusDeg) / tileDeg);
  const y0 = Math.floor((minLat - radiusDeg) / tileDeg);
  const y1 = Math.floor((maxLat + radiusDeg) / tileDeg);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return null;
  return { x0, y0, x1, y1 };
}

export function tileKey(x: number, y: number): string {
  return `t_${x}_${y}`;
}

export function tilesInRange(range: TileRange): string[] {
  const keys: string[] = [];
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) keys.push(tileKey(x, y));
  }
  return keys;
}

/**
 * Tile format v2: `{"v":2,"w":[[wayId, [[lat,lng],...], tags], ...]}` — ways
 * carry inline coordinates (tiles are self-contained, ways duplicated across
 * tiles dedupe by way id). Node identity is synthesized from the coordinate
 * key so ways sharing a junction node share one synthetic id (E3 relies on
 * this for graph stitching).
 */
interface TileJson {
  v: number;
  w: [number, [number, number][], Record<string, string>][];
}

/** Per-merge state shared across the tiles of one corridor. */
export interface TileMergeContext {
  coordIndex: Map<string, number>;
  wayIds: Set<number>;
}

export function createTileMergeContext(): TileMergeContext {
  return { coordIndex: new Map(), wayIds: new Set() };
}

export function parseTileJson(
  json: unknown,
  bundle: WaysBundle,
  ctx: TileMergeContext = createTileMergeContext(),
): void {
  const tile = json as TileJson;
  if (!tile || tile.v !== TILE_FORMAT_VERSION || !Array.isArray(tile.w)) {
    throw new Error('invalid tile format');
  }
  for (const [id, coords, tags] of tile.w) {
    if (!Array.isArray(coords) || coords.length < 2) continue;
    if (tags === undefined || tags['highway'] === undefined) continue;
    const attrs = parseWayTags(tags);
    if (!isRoutable(attrs)) continue;
    if (ctx.wayIds.has(id)) continue;
    ctx.wayIds.add(id);
    const nodeIds: number[] = [];
    for (const [lat, lng] of coords) {
      const key = `${lat.toFixed(7)},${lng.toFixed(7)}`;
      let nodeId = ctx.coordIndex.get(key);
      if (nodeId === undefined) {
        nodeId = -ctx.coordIndex.size - 1; // negative: synthetic, never collides with OSM ids
        bundle.nodes.set(nodeId, [lat, lng]);
        ctx.coordIndex.set(key, nodeId);
      }
      nodeIds.push(nodeId);
    }
    bundle.ways.push({ id, nodeIds, attrs });
  }
}

interface TileManifest {
  formatVersion: number;
  tileDeg: number;
  generatedAt: string;
  region?: string;
}

class TileHttpError extends Error {
  constructor(readonly status: number) {
    super(`tiles HTTP ${status}`);
  }
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new TileHttpError(res.status);
  return (await res.json()) as unknown;
}

/**
 * Fetch the corridor from the configured static tile host. Returns null when
 * no host is configured, the manifest is missing/incompatible, the corridor
 * exceeds the tile budget, or no tile in the corridor area exists (region
 * not built) — callers fall back to the Overpass chain. Individual 404 tiles
 * count as "no data in this tile" (region edges, lakes) and are skipped.
 */
/** Outcome of the tiles provider (E6 tiles-only mode). */
export type TilesResult =
  | { status: 'ok'; bundle: WaysBundle }
  | { status: 'not-configured' }
  | { status: 'region-miss' }
  | { status: 'unreachable' };

/** Thrown by the corridor chain when tiles-only mode fails. */
export type TileDataErrorReason = 'region-miss' | 'unreachable';
export class TileDataError extends Error {
  constructor(readonly reason: TileDataErrorReason) {
    super(
      reason === 'region-miss' ? 'region not covered by the tile build' : 'tile host unreachable',
    );
    this.name = 'TileDataError';
  }
}

export async function fetchCorridorViaTiles(
  points: [number, number][],
  radiusM: number,
  signal?: AbortSignal,
): Promise<TilesResult> {
  const base = getTileBaseUrl();
  if (!base || points.length === 0) return { status: 'not-configured' };

  const meanLat = points.reduce((s, p) => s + p[1], 0) / points.length;
  const radiusLat = radiusM / 111_320;
  const radiusLng = radiusM / (111_320 * Math.max(0.1, Math.cos((meanLat * Math.PI) / 180)));
  const range = corridorTileRange(points, Math.max(radiusLat, radiusLng));
  if (!range) return { status: 'region-miss' };

  try {
    if (sessionManifest === undefined) {
      sessionManifest = (await fetchJson(`${base}/manifest.json`, signal)) as TileManifest;
    }
    const manifest = sessionManifest;
    if (
      manifest === null ||
      manifest.formatVersion !== TILE_FORMAT_VERSION ||
      manifest.tileDeg !== TILE_DEG
    ) {
      // silently falling through here would send the user into the slow
      // Overpass/OSM-API chain without any hint why
      console.warn(
        '[tiles] tile build format is v' +
          (manifest?.formatVersion ?? '?') +
          ', expected v' +
          TILE_FORMAT_VERSION +
          ' — rebuild the tiles or update the app',
      );
      return { status: 'unreachable' };
    }

    const bundle: WaysBundle = { nodes: new Map(), ways: [] };
    const mergeCtx = createTileMergeContext();
    const keys = tilesInRange(range);
    let index = 0;
    let misses = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, keys.length) }, async () => {
      while (index < keys.length) {
        const key = keys[index++]!;
        // session cache: parsed tiles and known-missing tiles are reused
        // across corridors, so growing a polyline only fetches new tiles
        const cached = sessionTiles.get(key);
        if (cached !== undefined) {
          parseTileJson(cached, bundle, mergeCtx);
          continue;
        }
        if (sessionMissing.has(key)) {
          misses++;
          continue;
        }
        try {
          const json = await fetchJson(`${base}/${key}.json`, signal);
          sessionTiles.set(key, json);
          parseTileJson(json, bundle, mergeCtx);
        } catch (err) {
          // empty tile — the builder never writes tiles without ways
          if (err instanceof TileHttpError && err.status === 404) {
            sessionMissing.add(key);
            misses++;
            continue;
          }
          throw err;
        }
      }
    });
    await Promise.all(workers);
    // nothing found anywhere in the corridor area: region not built
    if (misses === keys.length) {
      console.warn('[tiles] corridor region not covered by the tile build');
      return { status: 'region-miss' };
    }
    return { status: 'ok', bundle };
  } catch (err) {
    console.warn('[tiles] tile host unreachable:', err instanceof Error ? err.message : err);
    return { status: 'unreachable' };
  }
}
