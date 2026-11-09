/**
 * Engine worker (E3.1, PLAN §5): corridor loading (cache → self-hosted tiles
 * → Overpass → OSM API), graph build, elevation attach, waypoint snapping and
 * bidirectional-A* routing — all off the main thread. The widening loop
 * retries the whole pipeline at 2 → 5 → 10 km — only when a waypoint is off
 * the network; normally-snapped waypoints route once with the beeline
 * fallback instead (fast path, no widening).
 */
import {
  corridorKey,
  decimatePoints,
  normalizePoints,
  type CorridorPoint,
} from '../lib/osm/corridor';
import { getCachedCorridor, putCachedCorridor } from '../lib/osm/corridorCache';
import { fetchCorridor, type WaysBundle } from '../lib/osm/overpass';
import { TileDataError } from '../lib/osm/staticTiles';
import { SnapIndex, type SnapResult } from '../lib/osm/snapIndex';
import { setTileBaseUrlOverride } from '../lib/osm/staticTiles';
import { buildGraph, type Graph } from './graph/build';
import { isElevationDegraded, loadElevations } from './elevation/terrarium';
import { planRoute } from './router/route';
import { RouteBlockedError } from './router/astar';
import type { EngineStage, HostToWorker, RiderSettings, WorkerToHost } from './protocol';

const RADIUS_STEPS = [2000, 5000, 10_000];
/** fallback when a radius change arrives before any plan */
const DEFAULT: RiderSettings = {
  uphill: { mtb: { min: 0, max: 2 }, sac: { min: 1, max: 3 } },
  downhill: { mtb: { min: 0, max: 3 }, sac: { min: 1, max: 4 } },
  forestRoadPreference: 0.5,
  avoidUntaggedSingletrail: false,
};

let snapIndex: SnapIndex | null = null;
let graph: Graph | null = null;
let currentRadius: number = RADIUS_STEPS[0]!;
let lastPoints: CorridorPoint[] = [];
let lastSnaps: (SnapResult | null)[] = [];
let lastSettings: RiderSettings | null = null;
let token = 0;
let abort: AbortController | null = null;
/** drag probes may snap from further away than the waypoint snap radius */
const PROBE_RADIUS_M = 150;
/**
 * Region the CURRENT graph was built from: bbox of the load's waypoints,
 * expanded by the load radius it was fetched with (matching the tile-range
 * math of fetchCorridorViaTiles). When a new plan's waypoints fall inside,
 * the graph + snap index are reused as-is — adding a waypoint costs a snap
 * + one A* run instead of re-parse + rebuild (the sluggishness fix).
 */
let loadedBounds: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null =
  null;
let loadedRadiusM = 0;

const post = (msg: WorkerToHost): void => self.postMessage(msg);

/** expand the load bbox by its radius (same deg conversion as the tile fetch) */
function coveredByLoadedRegion(points: CorridorPoint[], radiusM: number): boolean {
  if (!loadedBounds || radiusM > loadedRadiusM) return false;
  const meanLat =
    loadedBounds.minLat / 2 + loadedBounds.maxLat / 2;
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.1, Math.cos((meanLat * Math.PI) / 180)));
  const b = loadedBounds;
  return points.every(
    (p) =>
      p[0] >= b.minLng - dLng &&
      p[0] <= b.maxLng + dLng &&
      p[1] >= b.minLat - dLat &&
      p[1] <= b.maxLat + dLat,
  );
}

/** display positions per waypoint: snap position when snapped, raw otherwise */
function displayPositions(
  points: CorridorPoint[],
  snaps: (SnapResult | null)[],
): [number, number][] {
  return points.map((p, i) => {
    const snap = snaps[i];
    return snap ? [snap.lng, snap.lat] : [p[0], p[1]];
  });
}

function snapAll(points: CorridorPoint[], snapRadiusM: number): (SnapResult | null)[] {
  if (!snapIndex) return points.map(() => null);
  return points.map((p) => snapIndex!.snap(p[0], p[1], snapRadiusM));
}

async function loadBundle(
  points: CorridorPoint[],
  radiusM: number,
  my: number,
  onStage: (stage: EngineStage) => void,
): Promise<WaysBundle | null> {
  const key = corridorKey(decimatePoints(normalizePoints(points)), radiusM);
  const cached = await getCachedCorridor(key);
  if (my !== token) return null;
  if (cached) {
    const nodes = new Map<number, [number, number]>();
    for (const [id, lat, lng] of cached.nodes) nodes.set(id, [lat, lng]);
    return { nodes, ways: cached.ways };
  }
  try {
    const bundle = await fetchCorridor(
      points,
      radiusM,
      (stage) => {
        if (my === token) onStage(stage);
      },
      abort?.signal,
    );
    if (my !== token) return null;
    // fire-and-forget: a multi-MB IDB write must not delay snapping/routing
    // (the session tile cache keeps the corridor warm either way)
    void putCachedCorridor(key, {
      createdAt: Date.now(),
      nodes: [...bundle.nodes.entries()].map(([id, [lat, lng]]) => [id, lat, lng]),
      ways: bundle.ways,
    });
    return bundle;
  } catch (err) {
    // tiles-only failures carry their reason to the UI; the rest stays generic
    if (err instanceof TileDataError) throw err;
    if (abort?.signal.aborted) throw err;
    return null;
  }
}

function buildState(bundle: WaysBundle): void {
  graph = buildGraph(bundle);
  snapIndex = new SnapIndex({ nodes: bundle.nodes, ways: graph.keptWays });
  // memory instrumentation (E7.2, PLAN NFR-3): visible in devtools console
  if (import.meta.env.DEV) {
    const nodes = graph.nodeCount;
    const segs = graph.segments.length;
    const approxMb = ((nodes * 20 + segs * 32) / 1048576).toFixed(1);
    console.info(`[engine] graph: ${nodes} nodes, ${segs} segments (~${approxMb} MB arrays)`);
  }
}

/** plan pipeline for one corridor radius; returns the route or null to widen */
async function attempt(
  id: number,
  points: CorridorPoint[],
  settings: RiderSettings,
  radiusM: number,
  snapRadiusM: number,
  my: number,
  allowBeelines = false,
): Promise<'ok' | 'widen' | 'waypoint'> {
  post({ id, type: 'progress', stage: 0 });
  // fast path: the current graph already covers this plan (user request:
  // snapping/routing felt sluggish) — skip load + parse + graph rebuild
  const canReuse = graph !== null && snapIndex !== null && coveredByLoadedRegion(points, radiusM);
  let bundle: WaysBundle | null = null;
  if (!canReuse) {
    try {
      bundle = await loadBundle(points, radiusM, my, (stage) =>
        post({ id, type: 'progress', stage }),
      );
    } catch (err) {
      if (my !== token) return 'ok';
      if (err instanceof TileDataError) {
        post({
          id,
          type: 'error',
          code: err.reason === 'region-miss' ? 'region_not_built' : 'corridor',
        });
        return 'ok';
      }
      post({ id, type: 'error', code: 'corridor' });
      return 'ok';
    }
    if (my !== token) return 'ok'; // superseded — value ignored
    if (!bundle) {
      post({ id, type: 'error', code: 'corridor' });
      return 'ok';
    }
    buildState(bundle);
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    loadedBounds = {
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
    };
    loadedRadiusM = radiusM;
  }
  currentRadius = canReuse ? Math.max(currentRadius, radiusM) : radiusM;

  lastSnaps = snapAll(points, snapRadiusM);
  post({ id, type: 'ready', snaps: lastSnaps, radiusM });

  // a single waypoint has nothing to route — widening is pointless; wait for
  // the next waypoint instead (the corridor is loaded + cached now)
  if (lastSnaps.length < 2) return 'ok';

  // route FIRST on flat costs so the line appears instantly (E5 speed fix on
  // blocked networks); elevation is fetched afterwards and the route is
  // recomputed + re-posted with climb-aware costs when the data arrives
  const positions = displayPositions(points, lastSnaps);
  try {
    const route = planRoute(graph!, lastSnaps, settings, radiusM, {
      allowBeelines,
      positions,
    });
    post({ id, type: 'route', route });
  } catch (e) {
    if (e instanceof RouteBlockedError) return 'widen';
    return 'widen';
  }
  if (my !== token) return 'ok';

  // on the reuse path the elevations are already attached — the route above
  // is climb-aware; only a freshly built graph still needs them
  if (!graph!.nodeEle && !isElevationDegraded()) {
    post({ id, type: 'progress', stage: 4 });
    if (graph) {
      graph.nodeEle = await loadElevations(graph.nodeLng, graph.nodeLat, abort?.signal);
      if (graph.nodeEle) {
        // per-segment elevation delta — drives slope + climb-direction costs
        for (const seg of graph.segments) {
          seg.dz = graph.nodeEle[seg.v]! - graph.nodeEle[seg.u]!;
        }
        if (my !== token) return 'ok';
        try {
          const refined = planRoute(graph!, lastSnaps, settings, radiusM, {
            allowBeelines,
            positions,
          });
          post({ id, type: 'route', route: refined });
        } catch {
          // elevation made the route infeasible — keep the flat route shown
        }
      } else {
        // elevation unavailable: the flat route stands — but the loading pill
        // must still clear (a stuck "Loading elevation…" was the reported loop)
        post({ id, type: 'ready', snaps: lastSnaps, radiusM });
      }
    }
  }
  return 'ok';
}

async function plan(
  id: number,
  points: CorridorPoint[],
  settings: RiderSettings,
  tileBaseUrl: string | null,
  snapRadiusM: number,
): Promise<void> {
  const my = ++token;
  abort?.abort();
  abort = new AbortController();
  lastPoints = points;
  lastSettings = settings;
  setTileBaseUrlOverride(tileBaseUrl);

  // The widening loop only pays off when a waypoint is off the network
  // (user request): if every waypoint snaps against the current index, one
  // attempt at the base radius with the beeline fallback is enough — adding
  // a normally-snapped waypoint must not re-run 2 → 5 → 10 km. No index yet
  // (first plan / new region) → take the full path.
  const preSnaps = snapIndex ? snapAll(points, snapRadiusM) : null;
  if (preSnaps && preSnaps.every((s) => s !== null)) {
    await attempt(id, points, settings, RADIUS_STEPS[0]!, snapRadiusM, my, true);
    return;
  }

  for (let i = 0; i < RADIUS_STEPS.length; i++) {
    const result = await attempt(id, points, settings, RADIUS_STEPS[i]!, snapRadiusM, my);
    if (my !== token) return;
    if (result === 'ok') return;
    if (i < RADIUS_STEPS.length - 1) post({ id, type: 'widening' });
  }
  // all strict attempts failed — last resort (user request): connect the
  // blocked legs / unsnapped waypoints with beelines. Beelines need no
  // corridor data, so run at the base radius — when the graph is already
  // loaded and covers the points this reuses it instead of re-fetching 10 km
  await attempt(id, points, settings, RADIUS_STEPS[0]!, snapRadiusM, my, true);
}

function reroute(id: number, settings: RiderSettings): void {
  if (!graph) {
    post({ id, type: 'error', code: 'corridor' });
    return;
  }
  try {
    const positions = displayPositions(lastPoints, lastSnaps);
    const route = planRoute(graph, lastSnaps, settings, currentRadius, {
      allowBeelines: true,
      positions,
    });
    post({ id, type: 'route', route });
  } catch {
    post({ id, type: 'error', code: 'no_route' });
  }
}

function resnap(id: number, snapRadiusM: number, settings: RiderSettings): void {
  if (!snapIndex || lastPoints.length === 0) return;
  lastSnaps = snapAll(lastPoints, snapRadiusM);
  post({ id, type: 'ready', snaps: lastSnaps, radiusM: currentRadius });
  reroute(id, settings);
}

self.onmessage = (event: MessageEvent<HostToWorker>): void => {
  const msg = event.data;
  switch (msg.type) {
    case 'plan':
      void plan(msg.id, msg.points, msg.settings, msg.tileBaseUrl, msg.snapRadiusM);
      break;
    case 'reroute':
      reroute(msg.id, msg.settings);
      break;
    case 'setSnapRadius':
      resnap(msg.id, msg.snapRadiusM, lastSettings ?? DEFAULT);
      break;
    case 'snapProbe': {
      const snap = snapIndex ? snapIndex.snap(msg.lng, msg.lat, PROBE_RADIUS_M) : null;
      post({ type: 'snapProbeResult', lng: msg.lng, lat: msg.lat, snap });
      break;
    }
    case 'cancel':
      token++;
      abort?.abort();
      break;
  }
};
