/**
 * Route orchestration (E3.6/E3.7): legs between consecutive waypoint virtual
 * nodes, hop decoding into attributed segments, stats assembly. Also exposes
 * planRoute for tests; the widening loop (2→5→10 km) lives in the worker
 * around a corridor-rebuild callback.
 */
import { computeSegmentCosts, attachWaypoints, findPath, RouteBlockedError } from './astar';
import { effectiveDifficulty } from '../cost/model';
import type { SegmentCosts } from './astar';
import type { Graph } from '../graph/build';
import type { RiderSettings, RouteResult, RouteSegment, RouteLeg } from '../protocol';
import type { SnapResult } from '../../lib/osm/snapIndex';

/** Decode one hop (a→b) into travel data; virtual nodes use link portions. */
interface Hop {
  segIdx: number;
  dir: 0 | 1;
  portion: number;
  fromLat: number;
  fromLng: number;
  fromEle: number | null;
  toLat: number;
  toLng: number;
  toEle: number | null;
}

function coordOf(graph: Graph, attach: ReturnType<typeof attachWaypoints>, node: number) {
  if (node < graph.nodeCount) {
    return {
      lat: graph.nodeLat[node]!,
      lng: graph.nodeLng[node]!,
      ele: graph.nodeEle ? graph.nodeEle[node]! : null,
    };
  }
  const v = attach.virtuals[node - graph.nodeCount]!;
  return { lat: v.lat, lng: v.lng, ele: null };
}

function decodeChain(
  graph: Graph,
  attach: ReturnType<typeof attachWaypoints>,
  chain: number[],
): Hop[] {
  const hops: Hop[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i]!;
    const b = chain[i + 1]!;
    // find the link a→b
    let segIdx: number | undefined;
    let dir: 0 | 1 = 0;
    let portion = 1;
    const findIn = (
      links: { to: number; segIdx: number; portion: number; dir: 0 | 1 }[],
    ): boolean => {
      for (const l of links) {
        if (l.to === b) {
          segIdx = l.segIdx;
          dir = l.dir;
          portion = l.portion;
          return true;
        }
      }
      return false;
    };
    if (a >= graph.nodeCount) {
      findIn(attach.virtuals[a - graph.nodeCount]!.links);
    } else {
      // CSR scan
      let found = false;
      for (let e = graph.offsets[a]!; e < graph.offsets[a + 1]!; e++) {
        if (graph.targets[e] === b) {
          segIdx = graph.segIdx[e]!;
          dir = graph.rev[e]! as 0 | 1;
          portion = 1;
          found = true;
          break;
        }
      }
      if (!found) {
        const attached = attach.atNode.get(a);
        if (attached) findIn(attached);
      }
    }
    if (segIdx === undefined) throw new Error(`broken chain hop ${a}→${b}`);
    const from = coordOf(graph, attach, a);
    const to = coordOf(graph, attach, b);
    hops.push({
      segIdx,
      dir,
      portion,
      fromLat: from.lat,
      fromLng: from.lng,
      fromEle: from.ele,
      toLat: to.lat,
      toLng: to.lng,
      toEle: to.ele,
    });
  }
  return hops;
}

function buildSegment(graph: Graph, costs: SegmentCosts, hop: Hop): RouteSegment {
  const seg = graph.segments[hop.segIdx]!;
  const attrs = graph.wayAttrs[seg.wayIdx]!;
  const eff = effectiveDifficulty(attrs);
  const dzTotal = graph.nodeEle ? seg.dz : 0;
  const dz = hop.dir === 0 ? dzTotal : -dzTotal; // travel-direction elevation change
  const dirDz = dz * hop.portion;
  const ascent = Math.max(0, dirDz);
  const descent = Math.max(0, -dirDz);
  const cost = hop.dir === 0 ? costs.fwd[hop.segIdx]! : costs.bwd[hop.segIdx]!;
  // coordinates: interpolate the virtual split points
  const coords: [number, number, number | null][] = [
    [hop.fromLat, hop.fromLng, hop.fromEle],
    [hop.toLat, hop.toLng, hop.toEle],
  ];
  return {
    wayId: graph.wayIds[seg.wayIdx]!,
    highway: attrs.highway,
    surface: attrs.surface,
    mtbDown: eff.mtbDown,
    mtbUp: eff.mtbUp,
    sac: eff.sac,
    difficultyTagged: eff.taggedMtb,
    coords,
    distanceM: seg.lenM * hop.portion,
    ascentM: ascent,
    descentM: descent,
    timeS: cost * hop.portion,
  };
}

/** Route a full waypoint chain; throws RouteBlockedError on an unreachable leg. */
export function planRoute(
  graph: Graph,
  snaps: (SnapResult | null)[],
  settings: RiderSettings,
  radiusM: number,
): RouteResult {
  if (snaps.length < 2) throw new RouteBlockedError(0);
  const costs = computeSegmentCosts(graph, settings);
  const attach = attachWaypoints(graph, snaps);
  const ctx = { graph, costs, attach };

  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < snaps.length; i++) {
    let chain: number[];
    try {
      chain = findPath(ctx, attach.wpNodes[i]!, attach.wpNodes[i + 1]!);
    } catch (e) {
      if (e instanceof RouteBlockedError) throw new RouteBlockedError(i);
      throw e;
    }
    const hops = decodeChain(graph, attach, chain);
    const segments = hops.map((h) => buildSegment(graph, costs, h));
    legs.push({
      segments,
      distanceM: segments.reduce((s, x) => s + x.distanceM, 0),
      ascentM: segments.reduce((s, x) => s + x.ascentM, 0),
      descentM: segments.reduce((s, x) => s + x.descentM, 0),
      timeS: segments.reduce((s, x) => s + x.timeS, 0),
    });
  }

  const kmByMtb = new Array(7).fill(0) as number[];
  for (const leg of legs) {
    for (const seg of leg.segments) {
      const eleA = seg.coords[0]?.[2];
      const eleB = seg.coords[1]?.[2];
      const uphill =
        eleA !== null && eleA !== undefined && eleB !== null && eleB !== undefined && eleB > eleA;
      const level = Math.max(0, Math.min(6, Math.round(uphill ? seg.mtbUp : seg.mtbDown)));
      kmByMtb[level]! += seg.distanceM / 1000;
    }
  }

  return {
    legs,
    total: {
      distanceM: legs.reduce((s, l) => s + l.distanceM, 0),
      ascentM: legs.reduce((s, l) => s + l.ascentM, 0),
      descentM: legs.reduce((s, l) => s + l.descentM, 0),
      timeS: legs.reduce((s, l) => s + l.timeS, 0),
    },
    kmByMtb: kmByMtb.map((km) => Math.round(km * 10) / 10),
    radiusM,
    elevationAvailable: graph.nodeEle !== null,
  };
}
