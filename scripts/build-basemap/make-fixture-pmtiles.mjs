// Dev fixture: hand-builds a tiny valid PMTiles v3 archive with a
// trail_difficulty layer (S2 + T3 trails near Natters/Innsbruck) so the
// trail overlay can be probed/validated locally without a planetiler build.
// Validated by reading it back through the same `pmtiles` reader the app
// uses in the browser. Not shipped — the real archive comes from planetiler
// (see trails.yml).
// Usage: node scripts/build-basemap/make-fixture-pmtiles.mjs [out.pmtiles]
import { FileSource, PMTiles, zxyToTileId } from 'pmtiles';
import { readFileSync, writeFileSync } from 'node:fs';
import geojsonVt from 'geojson-vt';
import vtPbf from 'vt-pbf';

const OUT = process.argv[2] ?? 'trails.pmtiles';

const fc = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { trail_label: 'S2', highway: 'path' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [11.34, 47.235],
          [11.348, 47.238],
          [11.356, 47.241],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { trail_label: 'T3', highway: 'path' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [11.338, 47.228],
          [11.346, 47.2245],
          [11.354, 47.221],
        ],
      },
    },
  ],
};

// --- MVT tiles ------------------------------------------------------------
const index = new geojsonVt(fc, { maxZoom: 15 });
/** @type {{ tileId: number; data: Uint8Array }[]} */
const tiles = [];
const d2r = (/** @type {number} */ d) => (d * Math.PI) / 180;
for (let z = 12; z <= 15; z++) {
  const xt = (/** @type {number} */ lon) => Math.floor(((lon + 180) / 360) * (1 << z));
  const yt = (/** @type {number} */ lat) =>
    Math.floor(
      ((1 - Math.log(Math.tan(d2r(lat)) + 1 / Math.cos(d2r(lat))) / Math.PI) / 2) * (1 << z),
    );
  const x0 = xt(11.33),
    x1 = xt(11.36),
    // tile y grows southwards → smaller y for the larger latitude
    y0 = yt(47.242),
    y1 = yt(47.221);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const t = index.getTile(z, x, y);
      if (!t || t.features.length === 0) continue;
      tiles.push({
        tileId: zxyToTileId(z, x, y),
        data: vtPbf.fromGeojsonVt({ trail_difficulty: t }),
      });
    }
  }
}
tiles.sort((a, b) => a.tileId - b.tileId);

// --- PMTiles v3 container (layout mirrored from the reader in node_modules)
/** unsigned LEB128 varint */
function varint(/** @type {number} */ v) {
  const out = [];
  v = BigInt(Math.floor(v));
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return out;
}

/** little-endian uint64 */
function u64(/** @type {number} */ v) {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, v >>> 0, true);
  dv.setUint32(4, Math.floor(v / 2 ** 32), true);
  return [...b];
}

const metadata = new TextEncoder().encode(
  JSON.stringify({
    name: 'MTB trail difficulties (dev fixture)',
    description: 'S/T labels for tagged OSM trails',
    version: '1',
    attribution: '&copy; OpenStreetMap contributors',
    vector_layers: [
      { id: 'trail_difficulty', fields: { trail_label: 'String', highway: 'String' } },
    ],
  }),
);
const HEADER_LEN = 127;

// offsets are absolute; the reader stores entry offset = varint - 1 (0 = runs
// into the previous entry). Root dir length depends on offset varint widths,
// which depend on the layout — iterate until the layout is stable. The root
// that is EMITTED is always the one built from the final offset base.
const count = tiles.length;
let dataBase = HEADER_LEN + 80; // first guess: 80-byte root for 13 entries
let rootDir, metaOffset, tileDataOffset;
for (let pass = 0; pass < 8; pass++) {
  const dir = [];
  dir.push(...varint(count));
  let prev = 0;
  for (const t of tiles) {
    dir.push(...varint(t.tileId - prev));
    prev = t.tileId;
  }
  for (const t of tiles) dir.push(...varint(1)); // runLength
  for (const t of tiles) dir.push(...varint(t.data.length));
  // offsets are RELATIVE to the tile-data section (the reader adds
  // tileDataOffset); stored value 0 means "runs into the previous entry"
  let cursor = 0;
  for (const t of tiles) {
    dir.push(...varint(cursor + 1));
    cursor += t.data.length;
  }
  rootDir = new Uint8Array(dir);
  metaOffset = HEADER_LEN + rootDir.length;
  const nextBase = metaOffset + metadata.length;
  if (nextBase === dataBase) break;
  dataBase = nextBase;
}
tileDataOffset = dataBase;

const tileBytes = tiles.reduce((s, t) => s + t.data.length, 0);
const header = new Uint8Array(HEADER_LEN);
{
  header.set([...'PMTiles'].map((c) => c.charCodeAt(0)), 0);
  header[7] = 3; // spec version
  const put = (/** @type {number} */ o, /** @type {number} */ v) => header.set(u64(v), o);
  put(8, HEADER_LEN); // root directory offset
  put(16, rootDir.length);
  put(24, metaOffset);
  put(32, metadata.length);
  put(40, 0); // leaf directory: none, all entries live in the root
  put(48, 0);
  put(56, tileDataOffset);
  put(64, tileBytes);
  put(72, tiles.length); // num addressed tiles
  put(80, tiles.length); // num tile entries
  put(88, tiles.length); // num tile contents
  header[96] = 0; // clustered
  header[97] = 1; // internal compression: None
  header[98] = 1; // tile compression: None
  header[99] = 1; // tile type: MVT
  header[100] = 12; // min zoom
  header[101] = 15; // max zoom
  const i32 = (/** @type {number} */ o, /** @type {number} */ deg) =>
    new DataView(header.buffer).setInt32(o, Math.round(deg * 1e7), true);
  i32(102, 11.33);
  i32(106, 47.21);
  i32(110, 11.36);
  i32(114, 47.242);
  header[118] = 14; // center zoom
  i32(119, 11.35);
  i32(123, 47.23);
}

const blob = new Uint8Array(tileDataOffset + tileBytes);
blob.set(header, 0);
blob.set(rootDir, HEADER_LEN);
blob.set(metadata, metaOffset);
let cursor = tileDataOffset;
for (const t of tiles) {
  blob.set(t.data, cursor);
  cursor += t.data.length;
}
writeFileSync(OUT, blob);
console.log(`wrote ${OUT}: ${blob.length} bytes, ${tiles.length} tiles (z12-15)`);

// --- self-check: read it back through the app's own reader ------------------
// FileSource wraps a Blob (slice().arrayBuffer()) — node 18+ has Blob global
const archive = new PMTiles(new FileSource(new Blob([readFileSync(OUT)])));
const h = await archive.getHeader();
console.log(
  `header: spec=${h.specVersion} zooms=${h.minZoom}-${h.maxZoom} tiles=${h.numAddressedTiles}`,
);
const z13x = Math.floor(((11.35 + 180) / 360) * (1 << 13));
const z13y = Math.floor(
  ((1 - Math.log(Math.tan(d2r(47.23)) + 1 / Math.cos(d2r(47.23))) / Math.PI) / 2) * (1 << 13),
);
const tile = await archive.getZxy(13, z13x, z13y);
if (!tile || tile.data.length === 0) throw new Error('self-check failed: z13 tile missing');
console.log(`self-check ok: z13/${z13x}/${z13y} -> ${tile.data.length} bytes MVT`);
