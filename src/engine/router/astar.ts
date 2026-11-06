/**
 * Routing (E3.6, PLAN §7.6): bidirectional A* over the CSR graph with
 * per-direction segment costs and virtual waypoint nodes (edge splitting per
 * PLAN §10). Pure module — unit-tested against synthetic graphs.
 */
import type { Graph } from '../graph/build';
import type { SnapResult } from '../../lib/osm/snapIndex';

export interface SegmentCosts {
  fwd: Float64Array;
  bwd: Float64Array;
  excludedFwd: Uint8Array;
  excludedBwd: Uint8Array;
}

/** Recompute per-segment costs from settings (the "reroute" fast path). */
export function computeSegmentCosts(graph: Graph, settings: RiderSettings): SegmentCosts {
  const n = graph.segments.length;
  const fwd = new Float64Array(n);
  const bwd = new Float64Array(n);
  const excludedFwd = new Uint8Array(n);
  const excludedBwd = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = graph.segments[i]!;
    const attrs = graph.wayAttrs[s.wayIdx]!;
    const dz = graph.nodeEle ? s.dz : 0;
    const climbFwd = s.lenM > 0 ? Math.max(0, dz) / s.lenM : 0;
    const climbBwd = s.lenM > 0 ? Math.max(0, -dz) / s.lenM : 0;
    const c = costFor(attrs, climbFwd, climbBwd, s.lenM, settings);
    fwd[i] = c.costFwd;
    bwd[i] = c.costBwd;
    excludedFwd[i] = c.excludedFwd ? 1 : 0;
    excludedBwd[i] = c.excludedBwd ? 1 : 0;
  }
  return { fwd, bwd, excludedFwd, excludedBwd };
}

// --- virtual waypoint nodes (PLAN §10 edge splitting) ----------------------

interface VirtualLink {
  to: number; // base node
  segIdx: number;
  portion: number; // 0..1 of the segment
  /** 0 = geometry-forward portion, 1 = geometry-backward portion */
  dir: 0 | 1;
}

interface VirtualNode {
  lat: number;
  lng: number;
  /** cost entries wp ⇄ both segment ends */
  links: VirtualLink[];
}

export interface Attachments {
  /** base node → links toward attached waypoints */
  atNode: Map<number, VirtualLink[]>;
  virtuals: VirtualNode[];
  /** virtual node id (graph.nodeCount + i) per waypoint */
  wpNodes: number[];
}

/**
 * Attach snapped waypoints to the graph as virtual nodes. Unsnapped
 * waypoints get a link-less virtual node (their legs will fail → widening).
 */
export function attachWaypoints(graph: Graph, snaps: (SnapResult | null)[]): Attachments {
  const virtuals: VirtualNode[] = [];
  const wpNodes: number[] = [];
  const atNode = new Map<number, VirtualLink[]>();
  const pushAt = (node: number, link: VirtualLink): void => {
    let list = atNode.get(node);
    if (!list) {
      list = [];
      atNode.set(node, list);
    }
    list.push(link);
  };

  snaps.forEach((snap) => {
    const wpId = graph.nodeCount + virtuals.length;
    const segIdxs = snap ? graph.waySegIdx.get(snap.wayId) : undefined;
    const segIdx = snap && segIdxs ? segIdxs[snap.nodeIndex] : undefined;
    if (!snap || segIdx === undefined) {
      virtuals.push({ lat: snap?.lat ?? 0, lng: snap?.lng ?? 0, links: [] });
      wpNodes.push(wpId);
      return;
    }
    const seg = graph.segments[segIdx]!;
    const t = Math.max(0, Math.min(1, snap.t));
    // costs: u→wp = F×t, wp→u = B×t, v→wp = B×(1−t), wp→v = F×(1−t)
    const links: VirtualLink[] = [
      { to: seg.u, segIdx, portion: t, dir: 1 },
      { to: seg.v, segIdx, portion: 1 - t, dir: 0 },
    ];
    pushAt(seg.u, { to: wpId, segIdx, portion: t, dir: 0 });
    pushAt(seg.v, { to: wpId, segIdx, portion: 1 - t, dir: 1 });
    virtuals.push({ lat: snap.lat, lng: snap.lng, links });
    wpNodes.push(wpId);
  });
  return { atNode, virtuals, wpNodes };
}

// --- bidirectional A* ------------------------------------------------------

import { costFor } from '../cost/model';
import type { RiderSettings } from '../protocol';

/** slightly above the max downhill cap → admissible heuristic */
const MAX_SPEED_MS = 34 / 3.6;

/** Error when a leg has no connection in the current corridor. */
export class RouteBlockedError extends Error {
  constructor(readonly legIndex: number) {
    super(`leg ${legIndex} blocked`);
    this.name = 'RouteBlockedError';
  }
}

// module-level scratch (A* runs sequentially in one worker)
let capacity = 0;
let gF = new Float64Array(0);
let gB = new Float64Array(0);
let stampF = new Int32Array(0);
let stampB = new Int32Array(0);
let parentF = new Int32Array(0);
let parentB = new Int32Array(0);
let epoch = 0;

class MinHeap {
  private keys: Float64Array;
  private values: Int32Array;
  private size = 0;

  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.values = new Int32Array(cap);
  }

  push(key: number, value: number): void {
    if (this.size >= this.keys.length) {
      const k = new Float64Array(this.keys.length * 2);
      k.set(this.keys.subarray(0, this.size));
      this.keys = k;
      const v = new Int32Array(this.values.length * 2);
      v.set(this.values.subarray(0, this.size));
      this.values = v;
    }
    let i = this.size++;
    this.keys[i] = key;
    this.values[i] = value;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number | undefined {
    if (this.size === 0) return undefined;
    const top = this.values[0]!;
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size]!;
      this.values[0] = this.values[this.size]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.size && this.keys[l]! < this.keys[smallest]!) smallest = l;
        if (r < this.size && this.keys[r]! < this.keys[smallest]!) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  get topKey(): number {
    return this.size > 0 ? this.keys[0]! : Infinity;
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = k;
    const v = this.values[a]!;
    this.values[a] = this.values[b]!;
    this.values[b] = v;
  }
}

export interface SearchContext {
  graph: Graph;
  costs: SegmentCosts;
  attach: Attachments;
}

export function findPath(ctx: SearchContext, source: number, target: number): number[] {
  const { graph, costs, attach } = ctx;
  const total = graph.nodeCount + attach.virtuals.length;

  if (capacity < total) {
    capacity = Math.max(total, 1024);
    gF = new Float64Array(capacity);
    gB = new Float64Array(capacity);
    stampF = new Int32Array(capacity);
    stampB = new Int32Array(capacity);
    parentF = new Int32Array(capacity);
    parentB = new Int32Array(capacity);
    epoch = 0;
  }
  epoch++;
  for (let i = 0; i < total; i++) {
    stampF[i] = epoch;
    stampB[i] = epoch;
    gF[i] = Infinity;
    gB[i] = Infinity;
    parentF[i] = -1;
    parentB[i] = -1;
  }

  const lngOf = (node: number): number =>
    node < graph.nodeCount ? graph.nodeLng[node]! : attach.virtuals[node - graph.nodeCount]!.lng;
  const latOf = (node: number): number =>
    node < graph.nodeCount ? graph.nodeLat[node]! : attach.virtuals[node - graph.nodeCount]!.lat;
  const h = (from: number, to: number): number => {
    const dLng = (lngOf(from) - lngOf(to)) * Math.cos((latOf(from) * Math.PI) / 180) * 111_320;
    const dLat = (latOf(from) - latOf(to)) * 110_540;
    return Math.hypot(dLng, dLat) / MAX_SPEED_MS;
  };

  const edgeCost = (segIdx: number, dir: 0 | 1): number =>
    dir === 0
      ? costs.excludedFwd[segIdx]
        ? Infinity
        : costs.fwd[segIdx]!
      : costs.excludedBwd[segIdx]
        ? Infinity
        : costs.bwd[segIdx]!;

  const scratch: [number, number][] = [];
  /** stub costs always pass, falling back to walking pace when excluded */
  const stubCost = (link: { segIdx: number; portion: number; dir: 0 | 1 }): number => {
    const base = link.dir === 0 ? costs.fwd[link.segIdx]! : costs.bwd[link.segIdx]!;
    const finite = Number.isFinite(base) ? base : graph.segments[link.segIdx]!.lenM / 1.25;
    return finite * link.portion;
  };
  const neighbors = (node: number): void => {
    scratch.length = 0;
    if (node < graph.nodeCount) {
      for (let e = graph.offsets[node]!; e < graph.offsets[node + 1]!; e++) {
        const c = edgeCost(graph.segIdx[e]!, graph.rev[e]! as 0 | 1);
        if (c !== Infinity) scratch.push([graph.targets[e]!, c]);
      }
      const attached = attach.atNode.get(node);
      if (attached) {
        for (const link of attached) scratch.push([link.to, stubCost(link)]);
      }
    } else {
      const virtual = attach.virtuals[node - graph.nodeCount]!;
      for (const link of virtual.links) scratch.push([link.to, stubCost(link)]);
    }
  };

  const openF = new MinHeap(1024);
  const openB = new MinHeap(1024);
  gF[source] = 0;
  gB[target] = 0;
  openF.push(h(source, target), source);
  openB.push(h(target, source), target);

  let best = Infinity;
  let meetNode = -1;

  while (openF.topKey + openB.topKey < best) {
    const fwdStep = openF.topKey <= openB.topKey;
    const open = fwdStep ? openF : openB;
    const node = open.pop();
    if (node === undefined) break;
    const g = fwdStep ? gF[node]! : gB[node]!;

    neighbors(node);
    for (const [next, c] of scratch) {
      const cand = g + c;
      if (fwdStep) {
        if (cand >= gF[next]!) continue;
        gF[next] = cand;
        parentF[next] = node;
        openF.push(cand + h(next, target), next);
        if (gB[next] !== Infinity && cand + gB[next]! < best) {
          best = cand + gB[next]!;
          meetNode = next;
        }
      } else {
        if (cand >= gB[next]!) continue;
        gB[next] = cand;
        parentB[next] = node;
        openB.push(cand + h(next, source), next);
        if (gF[next] !== Infinity && gF[next]! + cand < best) {
          best = gF[next]! + cand;
          meetNode = next;
        }
      }
    }
  }

  if (meetNode === -1) throw new RouteBlockedError(-1);

  // reconstruct source → meet → target (node chain, may include virtuals)
  const chain: number[] = [];
  for (let n = meetNode; n !== -1; n = parentF[n]!) chain.push(n);
  chain.reverse();
  for (let n = parentB[meetNode]!; n !== -1; n = parentB[n]!) chain.push(n);
  return chain;
}
