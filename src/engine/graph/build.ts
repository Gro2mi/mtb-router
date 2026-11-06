/**
 * Graph builder (E3.4, PLAN §5/§7): WaysBundle → compact CSR adjacency over
 * typed arrays. Ways are split into per-node-pair segments; oneway ways
 * produce a single directed edge; isolated small components are dropped so
 * routing stays in the connected road/trail network.
 */
import { haversineM } from '../../lib/osm/geo';
import type { WaysBundle } from '../../lib/osm/overpass';
import type { WayAttrs } from '../../lib/osm/tags';

export interface GraphSegment {
  u: number; // graph node index
  v: number;
  wayIdx: number;
  lenM: number;
  /** elevation gain u→v in meters (0 until elevation attach) */
  dz: number;
}

export interface Graph {
  nodeCount: number;
  nodeLng: Float64Array;
  nodeLat: Float64Array;
  /** elevation per node, null until attached (degraded mode) */
  nodeEle: Float32Array | null;
  /** CSR: directed edges [offsets[i] .. offsets[i+1]) belong to node i */
  offsets: Int32Array;
  targets: Int32Array;
  /** segment backing each directed edge */
  segIdx: Int32Array;
  /** 1 when the directed edge travels against the segment geometry (v→u) */
  rev: Uint8Array;
  segments: GraphSegment[];
  /** compact way table; attrs for segments' wayIdx */
  wayAttrs: WayAttrs[];
  wayIds: number[];
  /** wayId → segment indices in geometry order (for snap→segment resolution) */
  waySegIdx: Map<number, number[]>;
  /** bundle ways that survived the component filter (for the snap index) */
  keptWays: { id: number; nodeIds: number[]; attrs: WayAttrs }[];
}

/** oneway handling for bicycles (E3: directional edges). 0 = bidirectional. */
export function onewayDirection(attrs: WayAttrs): 0 | 1 | -1 {
  if (attrs.onewayBicycle === 'no') return 0;
  const ow = attrs.oneway;
  const roads = [
    'residential',
    'living_street',
    'tertiary',
    'secondary',
    'unclassified',
    'service',
  ];
  if (attrs.highway === 'cycleway' || roads.includes(attrs.highway)) {
    if (ow === 'yes' || ow === '1') return 1;
    if (ow === '-1') return -1;
  }
  return 0;
}

export function buildGraph(bundle: WaysBundle): Graph {
  // node ids → dense indices
  const nodeIndex = new Map<number, number>();
  const lat: number[] = [];
  const lng: number[] = [];
  for (const [id, coord] of bundle.nodes) {
    nodeIndex.set(id, lat.length);
    lat.push(coord[0]);
    lng.push(coord[1]);
  }

  // candidate segments + union-find components
  const parent = new Int32Array(lat.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[x] !== root) {
      const next = parent[x]!;
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const wayAttrs: WayAttrs[] = [];
  const wayIds: number[] = [];
  const waySegIdx = new Map<number, number[]>();
  const candidates: GraphSegment[] = [];
  const candidateWay: number[] = [];

  for (const way of bundle.ways) {
    const wayIdx = wayAttrs.length;
    wayAttrs.push(way.attrs);
    wayIds.push(way.id);
    for (let i = 0; i + 1 < way.nodeIds.length; i++) {
      const u = nodeIndex.get(way.nodeIds[i]!);
      const v = nodeIndex.get(way.nodeIds[i + 1]!);
      if (u === undefined || v === undefined || u === v) continue;
      const lenM = haversineM(lng[u]!, lat[u]!, lng[v]!, lat[v]!);
      if (lenM <= 0) continue;
      union(u, v);
      candidates.push({ u, v, wayIdx, lenM, dz: 0 });
      candidateWay.push(wayIdx);
    }
  }

  // keep only the largest connected component (PLAN E3.4)
  const compSize = new Map<number, number>();
  for (let i = 0; i < lat.length; i++) {
    const root = find(i);
    compSize.set(root, (compSize.get(root) ?? 0) + 1);
  }
  let bestRoot = 0;
  let bestSize = -1;
  for (const [root, size] of compSize) {
    if (size > bestSize) {
      bestSize = size;
      bestRoot = root;
    }
  }

  const segments: GraphSegment[] = [];
  const keptWaySet = new Set<number>();
  for (let i = 0; i < candidates.length; i++) {
    if (find(candidates[i]!.u) === bestRoot) {
      const seg = candidates[i]!;
      seg.wayIdx = candidateWay[i]!;
      segs_of_way(waySegIdx, wayIds[candidateWay[i]!]!).push(segments.length);
      segments.push(seg);
      keptWaySet.add(wayIds[candidateWay[i]!]!);
    }
  }

  // CSR build (typed arrays)
  const nodeCount = lat.length;
  const degree = new Int32Array(nodeCount);
  for (const s of segments) {
    const dir = onewayDirection(wayAttrs[s.wayIdx]!);
    if (dir !== -1) degree[s.u]!++;
    if (dir !== 1) degree[s.v]!++;
  }
  const offsets = new Int32Array(nodeCount + 1);
  let acc = 0;
  for (let i = 0; i < nodeCount; i++) {
    offsets[i] = acc;
    acc += degree[i]!;
  }
  offsets[nodeCount] = acc;
  const targets = new Int32Array(acc);
  const segIdx = new Int32Array(acc);
  const rev = new Uint8Array(acc);
  const cursor = Int32Array.from(offsets);
  const pushEdge = (from: number, to: number, seg: number, isRev: boolean): void => {
    const at = cursor[from]!++;
    targets[at] = to;
    segIdx[at] = seg;
    rev[at] = isRev ? 1 : 0;
  };
  for (let si = 0; si < segments.length; si++) {
    const s = segments[si]!;
    const dir = onewayDirection(wayAttrs[s.wayIdx]!);
    if (dir !== -1) pushEdge(s.u, s.v, si, false);
    if (dir !== 1) pushEdge(s.v, s.u, si, true);
  }

  const keptWays = bundle.ways
    .filter((w) => keptWaySet.has(w.id))
    .map((w) => ({ id: w.id, nodeIds: w.nodeIds, attrs: w.attrs }));

  return {
    nodeCount,
    nodeLng: Float64Array.from(lng),
    nodeLat: Float64Array.from(lat),
    nodeEle: null,
    offsets,
    targets,
    segIdx,
    rev,
    segments,
    wayAttrs,
    wayIds,
    waySegIdx,
    keptWays,
  };
}

/** helper kept separate so the main loop stays linear */
function segs_of_way(map: Map<number, number[]>, wayId: number): number[] {
  let list = map.get(wayId);
  if (!list) {
    list = [];
    map.set(wayId, list);
  }
  return list;
}
