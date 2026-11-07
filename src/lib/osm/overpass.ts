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
import { fetchCorridorViaTiles, TileDataError } from './staticTiles';

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
 * Single timeout per stage with STAGGERED mirror starts: the next mirror is
 * only contacted when the previous one has not answered within the stagger
 * window. Healthy networks send exactly one request per stage; black-holed
 * hosts cost one stagger step each, bounded by the stage timeout.
 */
const STAGE_TIMEOUTS_MS = [15_000, 45_000]; // stage 1 (trails), stage 2 (roads)
const MIRROR_STAGGER_MS = 2_000;
const MIRROR_COOLDOWN_MS = 5 * 60_000;
const OVERPASS_COOLDOWN_MS = 5 * 60_000;
/** Guard against absurd corridor responses (PLAN NFR-3 memory budget). */
const MAX_ELEMENTS = 1_500_000;

/** Mirrors that failed recently are skipped for the cooldown window. */
const mirrorCooldownUntil = new Map<string, number>();
/** When every mirror is in cooldown, Overpass is skipped entirely. */
let overpassBlockedUntil = 0;

export function resetOverpassState(): void {
  mirrorCooldownUntil.clear();
  overpassBlockedUntil = 0;
}

export function isOverpassBlocked(): boolean {
  return Date.now() < overpassBlockedUntil;
}

function availableMirrors(now: number): string[] {
  return OVERPASS_MIRRORS.filter((m) => (mirrorCooldownUntil.get(m) ?? 0) <= now);
}

async function fetchQuery(
  query: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const now = Date.now();
  const mirrors = availableMirrors(now);
  if (mirrors.length === 0) throw new Error('all Overpass mirrors cooling down');

  const controllers = mirrors.map(() => new AbortController());
  // distinguishes a superseded plan's abort from a timeout abort — the
  // former is not a mirror failure and must not set the cooldown
  let outerAborted = false;
  const onOuterAbort = (): void => {
    outerAborted = true;
    for (const c of controllers) c.abort();
  };
  const timer = setTimeout(() => {
    for (const c of controllers) c.abort();
  }, timeoutMs);
  signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const attempts = mirrors.map((mirror, i) => {
      const controller = controllers[i]!;
      return new Promise<unknown>((resolve, reject) => {
        const startTimer = setTimeout(() => {
          if (outerAborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }
          fetch(mirror, {
            method: 'POST',
            body: query,
            headers: { 'Content-Type': 'text/plain' },
            signal: controller.signal,
          })
            .then(async (res) => {
              if (!res.ok) throw new Error(`Overpass ${res.status} at ${new URL(mirror).host}`);
              resolve((await res.json()) as unknown);
            })
            .catch((err: unknown) => {
              // a timed-out / errored mirror is skipped for the cooldown window;
              // a superseded plan's abort is not a mirror failure
              if (!outerAborted) mirrorCooldownUntil.set(mirror, Date.now() + MIRROR_COOLDOWN_MS);
              reject(err instanceof Error ? err : new Error(String(err)));
            });
        }, i * MIRROR_STAGGER_MS);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(startTimer);
            reject(new DOMException('aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    });
    const json = await Promise.any(attempts);
    // stop staggered starts + in-flight losers
    outerAborted = true;
    for (const c of controllers) c.abort();
    return json;
  } catch (err) {
    if (signal?.aborted || outerAborted) throw err;
    throw err instanceof AggregateError ? (err.errors[0] ?? err) : err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
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
    // defensive: stages/mirrors could theoretically overlap
    if (bundle.ways.some((w) => w.id === el.id)) continue;
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

export type CorridorStage = 0 | 1 | 2 | 3; // 0 = self-hosted tiles, 3 = OSM API fallback

export type StageReporter = (stage: CorridorStage) => void;

export async function fetchCorridor(
  points: CorridorPoint[],
  radiusM: number,
  onStage: StageReporter = () => {},
  signal?: AbortSignal,
): Promise<WaysBundle> {
  // stage 0: self-hosted static tiles — fastest path and immune to
  // third-party server blocks. When a tile host is resolved it is the ONLY
  // provider (user request): a miss is an error, not a reason to grind the
  // potentially-blocked public chain.
  onStage(0);
  const result = await fetchCorridorViaTiles(points, radiusM, signal);
  if (result.status === 'ok') return compactBundle(result.bundle);
  if (result.status === 'region-miss' || result.status === 'unreachable') {
    throw new TileDataError(result.status);
  }

  // no tile host configured → public chain: a network that black-holes
  // Overpass burns the stage timeout once; afterwards Overpass is skipped
  // entirely for the cooldown window
  const overpassAllowed = Date.now() >= overpassBlockedUntil;
  const queries = overpassAllowed ? buildStageQueries(points, radiusM) : [];
  const bundle: WaysBundle = { nodes: new Map(), ways: [] };
  if (overpassAllowed) {
    try {
      for (let i = 0; i < queries.length; i++) {
        onStage((i + 1) as 1 | 2);
        const json = await fetchQuery(queries[i]!, STAGE_TIMEOUTS_MS[i] ?? 45_000, signal);
        parseStage(json, bundle);
      }
      return compactBundle(bundle);
    } catch (err) {
      if (signal?.aborted) throw err;
      overpassBlockedUntil = Date.now() + OVERPASS_COOLDOWN_MS;
    }
  }

  // every mirror failed / cooling down — the main OSM API is hosted on
  // different infrastructure and covers the same ground
  onStage(3);
  const fallback = await fetchCorridorViaOsmApi(points, radiusM, signal);
  return compactBundle(fallback);
}
