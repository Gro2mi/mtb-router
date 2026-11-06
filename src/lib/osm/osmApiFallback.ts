/**
 * OSM API fallback provider: when every Overpass mirror is unreachable, fetch
 * the corridor via `https://api.openstreetmap.org/api/0.6/map` (main OSM API —
 * different infrastructure than the Overpass mirrors). The endpoint serves a
 * bbox of raw OSM XML with a 50 000-node limit per request, so the corridor is
 * covered by a set of small boxes (with adaptive quadrant-splitting on
 * "too many nodes" responses). Usage policy: ≤ 2 requests/second — requests
 * are throttled accordingly.
 */
import { isRoutable, parseWayTags } from './tags';
import type { WaysBundle } from './overpass';

const OSM_API_MAP = 'https://api.openstreetmap.org/api/0.6/map';

/** Box edge in degrees (~1.3 km lat) — small enough for dense Alpine terrain. */
const MAX_BOX_DEG = 0.012;
/** Hard cap on requests per corridor (coverage degrades gracefully beyond). */
const MAX_BOXES = 24;
/** api.openstreetmap.org policy: max 2 req/s. */
const REQUEST_SPACING_MS = 550;

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

function splitBox(box: Bbox): Bbox[] {
  const midLng = (box.west + box.east) / 2;
  const midLat = (box.south + box.north) / 2;
  return [
    { west: box.west, south: box.south, east: midLng, north: midLat },
    { west: midLng, south: box.south, east: box.east, north: midLat },
    { west: box.west, south: midLat, east: midLng, north: box.north },
    { west: midLng, south: midLat, east: box.east, north: box.north },
  ];
}

/** Cover the padded polyline with capped-size boxes (pure, unit-tested). */
export function planBoxes(points: [number, number][], radiusDeg: number): Bbox[] {
  const boxes: Bbox[] = [];
  const anchors: [number, number][] = points.length > 0 ? points : [[0, 0]];
  for (let i = 0; i + 1 < anchors.length || anchors.length === 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1] ?? a; // single point -> degenerate segment
    const west = Math.min(a[0], b[0]) - radiusDeg;
    const east = Math.max(a[0], b[0]) + radiusDeg;
    const south = Math.min(a[1], b[1]) - radiusDeg;
    const north = Math.max(a[1], b[1]) + radiusDeg;
    const cols = Math.max(1, Math.ceil((east - west) / MAX_BOX_DEG));
    const rows = Math.max(1, Math.ceil((north - south) / MAX_BOX_DEG));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        boxes.push({
          west: west + ((east - west) * c) / cols,
          east: west + ((east - west) * (c + 1)) / cols,
          south: south + ((north - south) * r) / rows,
          north: south + ((north - south) * (r + 1)) / rows,
        });
      }
    }
    if (anchors.length === 1) break;
    if (boxes.length >= MAX_BOXES) break;
  }
  return boxes.slice(0, MAX_BOXES);
}

function unescapeXml(s: string): string {
  return s
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * Minimal regex parse of OSM XML (no DOMParser → also worker-safe for E3).
 * The OSM API emits stable, machine-generated XML; attribute values escape
 * inner quotes, so `[^"]*` is safe.
 */
export function parseOsmXml(xml: string, bundle: WaysBundle): void {
  // attribute order in the XML is not contractual — extract per opening tag
  for (const m of xml.matchAll(/<node\s[^>]*>/g)) {
    const open = m[0];
    const id = /id="(\d+)"/.exec(open)?.[1];
    const lat = /\blat="([-\d.]+)"/.exec(open)?.[1];
    const lon = /\blon="([-\d.]+)"/.exec(open)?.[1];
    if (id === undefined || lat === undefined || lon === undefined) continue;
    const nodeId = Number(id);
    if (!bundle.nodes.has(nodeId)) bundle.nodes.set(nodeId, [Number(lat), Number(lon)]);
  }

  for (const m of xml.matchAll(/<way\s[^>]*>[\s\S]*?<\/way>|<way\s[^>]*\/>/g)) {
    const block = m[0];
    const id = /id="(\d+)"/.exec(block)?.[1];
    if (id === undefined) continue;
    const wayId = Number(id);
    const body = block.includes('</way>') ? block.slice(block.indexOf('>') + 1) : '';
    const nodeIds: number[] = [];
    for (const nd of body.matchAll(/<nd\s+ref="(\d+)"\s*\/>/g)) nodeIds.push(Number(nd[1]));
    if (nodeIds.length < 2) continue;
    const tags: Record<string, string> = {};
    for (const tag of body.matchAll(/<tag\s+k="([^"]*)"\s+v="([^"]*)"\s*\/>/g)) {
      tags[unescapeXml(tag[1]!)] = unescapeXml(tag[2]!);
    }
    if (tags['highway'] === undefined) continue;
    const attrs = parseWayTags(tags);
    if (!isRoutable(attrs)) continue;
    if (bundle.ways.some((w) => w.id === wayId)) continue;
    bundle.ways.push({ id: wayId, nodeIds, attrs });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBox(
  box: Bbox,
  bundle: WaysBundle,
  signal: AbortSignal | undefined,
  depth = 0,
): Promise<void> {
  const url =
    `${OSM_API_MAP}?bbox=${box.west.toFixed(5)},${box.south.toFixed(5)},` +
    `${box.east.toFixed(5)},${box.north.toFixed(5)}`;
  const res = await fetch(url, { signal });
  if (res.status === 400 && depth < 3) {
    // "too many nodes" — read body to be sure, then split into quadrants
    await res.text();
    const quads = splitBox(box);
    for (const quad of quads) {
      await sleep(REQUEST_SPACING_MS);
      await fetchBox(quad, bundle, signal, depth + 1);
    }
    return;
  }
  if (!res.ok) throw new Error(`OSM API ${res.status}`);
  parseOsmXml(await res.text(), bundle);
}

/**
 * Fetch the corridor through the main OSM API. Throws when the API is
 * unreachable too — the caller surfaces the corridor error state.
 */
export async function fetchCorridorViaOsmApi(
  points: [number, number][],
  radiusM: number,
  signal?: AbortSignal,
): Promise<WaysBundle> {
  // meters → degrees: lat is fixed, lng scaled by cos(mean lat)
  const meanLat = points.reduce((sum, p) => sum + p[1], 0) / Math.max(1, points.length);
  const radiusLat = radiusM / 111_320;
  const radiusLng = radiusM / (111_320 * Math.max(0.1, Math.cos((meanLat * Math.PI) / 180)));

  const boxes = planBoxes(points, Math.max(radiusLat, radiusLng));
  const bundle: WaysBundle = { nodes: new Map(), ways: [] };
  for (let i = 0; i < boxes.length; i++) {
    if (i > 0) await sleep(REQUEST_SPACING_MS);
    await fetchBox(boxes[i]!, bundle, signal);
  }
  return bundle;
}
