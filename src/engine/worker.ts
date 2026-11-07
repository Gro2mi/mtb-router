/**
 * Engine worker (E3.1, PLAN §5): corridor loading (cache → self-hosted tiles
 * → Overpass → OSM API), graph build, elevation attach, waypoint snapping and
 * bidirectional-A* routing — all off the main thread. The widening loop
 * retries the whole pipeline at 2 → 5 → 10 km when a leg is unreachable.
 */
import {
  corridorKey,
  decimatePoints,
  normalizePoints,
  type CorridorPoint,
} from '../lib/osm/corridor';
import { getCachedCorridor, putCachedCorridor } from '../lib/osm/corridorCache';
import { fetchCorridor, type WaysBundle } from '../lib/osm/overpass';
import { SnapIndex, type SnapResult } from '../lib/osm/snapIndex';
import { setTileBaseUrlOverride } from '../lib/osm/staticTiles';
import { buildGraph, type Graph } from './graph/build';
import { loadElevations } from './elevation/terrarium';
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

const post = (msg: WorkerToHost): void => self.postMessage(msg);

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
    await putCachedCorridor(key, {
      createdAt: Date.now(),
      nodes: [...bundle.nodes.entries()].map(([id, [lat, lng]]) => [id, lat, lng]),
      ways: bundle.ways,
    });
    return bundle;
  } catch {
    return null;
  }
}

function buildState(bundle: WaysBundle): void {
  graph = buildGraph(bundle);
  snapIndex = new SnapIndex({ nodes: bundle.nodes, ways: graph.keptWays });
}

/** plan pipeline for one corridor radius; returns the route or null to widen */
async function attempt(
  id: number,
  points: CorridorPoint[],
  settings: RiderSettings,
  radiusM: number,
  snapRadiusM: number,
  my: number,
): Promise<'ok' | 'widen' | 'waypoint'> {
  post({ id, type: 'progress', stage: 0 });
  const bundle = await loadBundle(points, radiusM, my, (stage) =>
    post({ id, type: 'progress', stage }),
  );
  if (my !== token) return 'ok'; // superseded — value ignored
  if (!bundle) {
    post({ id, type: 'error', code: 'corridor' });
    return 'ok';
  }
  buildState(bundle);
  currentRadius = radiusM;

  post({ id, type: 'progress', stage: 4 });
  if (graph) {
    graph.nodeEle = await loadElevations(graph.nodeLng, graph.nodeLat, abort?.signal);
    if (graph.nodeEle) {
      // per-segment elevation delta — drives slope + climb-direction costs
      for (const seg of graph.segments) {
        seg.dz = graph.nodeEle[seg.v]! - graph.nodeEle[seg.u]!;
      }
    }
  }
  if (my !== token) return 'ok';

  lastSnaps = snapAll(points, snapRadiusM);
  post({ id, type: 'ready', snaps: lastSnaps, radiusM });

  // a single waypoint has nothing to route — widening is pointless; wait for
  // the next waypoint instead (the corridor is loaded + cached now)
  if (lastSnaps.length < 2) return 'ok';

  try {
    const route = planRoute(graph!, lastSnaps, settings, radiusM);
    post({ id, type: 'route', route });
    return 'ok';
  } catch (e) {
    if (e instanceof RouteBlockedError && lastSnaps.some((s) => s === null)) return 'waypoint';
    return 'widen';
  }
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

  for (let i = 0; i < RADIUS_STEPS.length; i++) {
    const result = await attempt(id, points, settings, RADIUS_STEPS[i]!, snapRadiusM, my);
    if (my !== token) return;
    if (result === 'ok') return;
    if (result === 'waypoint') {
      post({ id, type: 'error', code: 'waypoint' });
      return;
    }
    if (i < RADIUS_STEPS.length - 1) post({ id, type: 'widening' });
  }
  post({ id, type: 'error', code: 'no_route' });
}

function reroute(id: number, settings: RiderSettings): void {
  if (!graph) {
    post({ id, type: 'error', code: 'corridor' });
    return;
  }
  try {
    const route = planRoute(graph, lastSnaps, settings, currentRadius);
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
