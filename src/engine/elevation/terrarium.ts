/**
 * Elevation service (E3.5, PLAN §9): AWS Terrain Tiles ("terrarium" PNG,
 * public domain, no key) decoded in the worker via OffscreenCanvas, cached in
 * IndexedDB and bilinearly sampled per graph node. Any failure degrades to
 * null elevations (flat cost model, `incline`-less) — never blocks routing.
 */
import { getElevationTile, putElevationTile } from '../../lib/osm/corridorCache';

const ZOOM = 12;
const TILE_PX = 256;
const WORLD_PX = TILE_PX * 2 ** ZOOM; // 4096 × 256
const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

const memoryCache = new Map<string, Float32Array>();
/** once tiles prove unreachable, skip further attempts in this session */
let degraded = false;

export function tileFor(lng: number, lat: number): { x: number; y: number } {
  const xf = ((lng + 180) / 360) * 2 ** ZOOM;
  const latRad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** ZOOM;
  return { x: Math.floor(xf), y: Math.floor(yf) };
}

/** global pixel coordinates (fractional) for bilinear sampling */
function globalPixel(lng: number, lat: number): { gx: number; gy: number } {
  const xf = ((lng + 180) / 360) * WORLD_PX;
  const latRad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * WORLD_PX;
  return { gx: xf, gy: yf };
}

async function decodeTile(png: ArrayBuffer): Promise<Float32Array> {
  const blob = new Blob([png], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const size = bitmap.width;
  const elevations = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    elevations[i] = r * 256 + g + b / 256 - 32768;
  }
  bitmap.close();
  return elevations;
}

async function loadTile(x: number, y: number, signal?: AbortSignal): Promise<Float32Array> {
  const key = `${ZOOM}/${x}/${y}`;
  const mem = memoryCache.get(key);
  if (mem) return mem;

  const cached = await getElevationTile(key);
  if (cached && cached.tileSize === TILE_PX) {
    memoryCache.set(key, cached.data);
    return cached.data;
  }

  const res = await fetch(`${TERRARIUM_URL}/${ZOOM}/${x}/${y}.png`, { signal });
  if (!res.ok) throw new Error(`elevation HTTP ${res.status}`);
  const elevations = await decodeTile(await res.arrayBuffer());
  memoryCache.set(key, elevations);
  await putElevationTile(key, { z: ZOOM, x, y, data: elevations, tileSize: TILE_PX });
  return elevations;
}

function sampleTile(
  tile: Float32Array,
  tileX: number,
  tileY: number,
  gx: number,
  gy: number,
): number {
  const px = gx - tileX * TILE_PX;
  const py = gy - tileY * TILE_PX;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const at = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(TILE_PX - 1, x));
    const cy = Math.max(0, Math.min(TILE_PX - 1, y));
    return tile[cy * TILE_PX + cx]!;
  };
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Elevation per graph node. Returns null when any tile is unavailable or
 * slow (offline / blocked networks black-hole instead of erroring) — callers
 * run in degraded mode with flat slopes.
 */
export async function loadElevations(
  nodeLng: Float64Array,
  nodeLat: Float64Array,
  signal?: AbortSignal,
  timeoutMs = 6_000,
): Promise<Float32Array | null> {
  if (degraded) return null;
  try {
    const needed = new Map<string, { x: number; y: number }>();
    for (let i = 0; i < nodeLng.length; i++) {
      const t = tileFor(nodeLng[i]!, nodeLat[i]!);
      needed.set(`${t.x}/${t.y}`, t);
    }
    const tiles = new Map<string, Float32Array>();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('elevation timeout')), timeoutMs),
    );
    for (const [key, t] of needed) {
      tiles.set(key, await Promise.race([loadTile(t.x, t.y, signal), timeout]));
    }
    const elevations = new Float32Array(nodeLng.length);
    for (let i = 0; i < nodeLng.length; i++) {
      const { gx, gy } = globalPixel(nodeLng[i]!, nodeLat[i]!);
      const t = tileFor(nodeLng[i]!, nodeLat[i]!);
      elevations[i] = sampleTile(tiles.get(`${t.x}/${t.y}`)!, t.x, t.y, gx, gy);
    }
    return elevations;
  } catch {
    degraded = true; // blocked/black-holed — don't re-burn the timeout per attempt
    return null; // degraded mode
  }
}

/** test hook: clear in-memory tiles between tests */
export function clearElevationCache(): void {
  memoryCache.clear();
  degraded = false;
}
