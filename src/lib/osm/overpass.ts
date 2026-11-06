/**
 * Overpass client (E2.3, PLAN §8): two-stage corridor queries with mirror
 * fallback, sticky-mirror preference and tiered timeouts (dead hosts fail
 * fast). When every mirror is unreachable, the corridor is fetched via the
 * main OSM API as a fallback (see osmApiFallback.ts). Runs on the main thread
 * for E2; E3 moves it into the engine worker.
 */
import { buildStageQueries, type CorridorPoint } from './corridor';
import { isRoutable, parseWayTags, type WayAttrs } from './tags';
import { fetchCorridorViaOsmApi } from './osmApiFallback';
import { fetchCorridorViaTiles } from './staticTiles';

export interface ParsedWay {
  id: number;
  nodeIds: number[];
  attrs: WayAttrs;
}

/** Parsed, filtered corridor data. Nodes are [lat, lng] pairs. */
export interface WaysBundle {
  nodes: Map<number, [number, number]>;
  ways: ParsedWay[];
}

/** Public mirrors, tried in order (PLAN §8 etiquette: one corridor per action). */
export const OVERPASS_MIRRORS: readonly string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/**
 * Attempt timeouts escalate: a first contact gets a short window so networks
 * that black-hole Overpass hosts fail over quickly, later attempts allow time
 * for heavy but healthy queries.
 */
const ATTEMPT_TIMEOUTS_MS = [10_000, 25_000, 45_000];
/** Guard against absurd corridor responses (PLAN NFR-3 memory budget). */
const MAX_ELEMENTS = 1_500_000;

/** Mirror that answered most recently — tried first while it keeps working. */
let preferredMirror: string | null = null;

export type CorridorStage = 0 | 1 | 2 | 3; // 0 = self-hosted tiles, 3 = OSM API fallback

export type StageReporter = (stage: CorridorStage) => void;

async function fetchQuery(query: string, signal?: AbortSignal): Promise<unknown> {
  const order = preferredMirror
    ? [preferredMirror, ...OVERPASS_MIRRORS.filter((m) => m !== preferredMirror)]
    : [...OVERPASS_MIRRORS];
  let lastError: unknown = new Error('no mirrors configured');

  for (let attempt = 0; attempt < order.length; attempt++) {
    const mirror = order[attempt]!;
    const timeoutMs =
      preferredMirror === mirror
        ? ATTEMPT_TIMEOUTS_MS[2]! // trusted mirror gets the full window
        : ATTEMPT_TIMEOUTS_MS[Math.min(attempt, ATTEMPT_TIMEOUTS_MS.length - 1)]!;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status} at ${new URL(mirror).host}`);
      preferredMirror = mirror;
      return (await res.json()) as unknown;
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw err;
      // try the next mirror
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }
  throw lastError;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export function parseStage(json: unknown, bundle: WaysBundle): void {
  const elements = (json as { elements?: OverpassElement[] }).elements;
  if (!Array.isArray(elements)) throw new Error('unexpected Overpass response (no elements)');
  if (elements.length > MAX_ELEMENTS) throw new Error('corridor response too large');
  for (const el of elements) {
    if (el.type === 'node') {
      if (typeof el.id === 'number' && typeof el.lat === 'number' && typeof el.lon === 'number') {
        if (!bundle.nodes.has(el.id)) bundle.nodes.set(el.id, [el.lat, el.lon]);
      }
      continue;
    }
    if (el.type !== 'way') continue;
    if (!Array.isArray(el.nodes) || el.nodes.length < 2) continue;
    const attrs = parseWayTags(el.tags);
    if (!isRoutable(attrs)) continue;
    bundle.ways.push({ id: el.id, nodeIds: el.nodes.slice(), attrs });
  }
}

/** Drop nodes no kept way references (keeps memory + cache small). */
export function compactBundle(bundle: WaysBundle): WaysBundle {
  const used = new Set<number>();
  for (const way of bundle.ways) {
    for (const id of way.nodeIds) used.add(id);
  }
  const nodes = new Map<number, [number, number]>();
  for (const [id, coord] of bundle.nodes) {
    if (used.has(id)) nodes.set(id, coord);
  }
  return { nodes, ways: bundle.ways };
}

export async function fetchCorridor(
  points: CorridorPoint[],
  radiusM: number,
  onStage: StageReporter = () => {},
  signal?: AbortSignal,
): Promise<WaysBundle> {
  // stage 0: self-hosted static tiles (configured + region built) — fastest
  // path and immune to third-party server blocks
  onStage(0);
  const tiled = await fetchCorridorViaTiles(points, radiusM, signal);
  if (tiled) return compactBundle(tiled);

  const queries = buildStageQueries(points, radiusM);
  const bundle: WaysBundle = { nodes: new Map(), ways: [] };
  try {
    for (let i = 0; i < queries.length; i++) {
      onStage((i + 1) as 1 | 2);
      const json = await fetchQuery(queries[i]!, signal);
      parseStage(json, bundle);
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    // every mirror failed (unreachable / overloaded) — the main OSM API is
    // hosted on different infrastructure and covers the same ground
    onStage(3);
    const fallback = await fetchCorridorViaOsmApi(points, radiusM, signal);
    return compactBundle(fallback);
  }
  return compactBundle(bundle);
}
