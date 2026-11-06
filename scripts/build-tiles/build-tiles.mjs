#!/usr/bin/env node
/**
 * Tile builder for the self-hosted static data provider (see
 * src/lib/osm/staticTiles.ts). Produces 0.1° tiles of routable OSM ways with
 * inline coordinates (format v2), plus manifest.json, .htaccess (CORS + gzip)
 * and an upload summary. Pure Node — the PBF reader (pbf2json) ships as a
 * precompiled binary through npm, so no external tools are required.
 *
 * Input is auto-detected by extension:
 *
 *   # direct from a Geofabrik extract (recommended, no osmium needed):
 *   curl -L -O https://download.geofabrik.de/europe/austria-latest.osm.pbf
 *   node --max-old-space-size=6144 scripts/build-tiles/build-tiles.mjs \
 *     austria-latest.osm.pbf dist/tiles --region austria
 *
 *   # or from osmium-filtered OSM XML (alternative):
 *   osmium tags-filter extract.osm.pbf w/highway=... -o filtered.osm.xml
 *   node --max-old-space-size=6144 scripts/build-tiles/build-tiles.mjs \
 *     filtered.osm.xml dist/tiles --region austria
 *
 * Country-sized builds need a few GB of heap (hence --max-old-space-size) and
 * a few minutes; tile files are gzip-friendly JSON.
 */
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export const TILE_DEG = 0.1;
export const FORMAT_VERSION = 2;
/** Tag whitelist — everything the E2 snap index and E3 cost model consume. */
const KEEP_TAGS = new Set([
  'highway',
  'surface',
  'tracktype',
  'mtb:scale',
  'mtb:scale:uphill',
  'sac_scale',
  'bicycle',
  'bicycle:forward',
  'bicycle:backward',
  'foot',
  'access',
  'motorroad',
  'segregated',
  'incline',
]);

/**
 * Assign each way to every tile its geometry touches. Tile key format must
 * match src/lib/osm/staticTiles.ts tileKey().
 *
 * @param {Iterable<import('./build-tiles.d.mts').WayEvent>} ways
 * @param {{ tileDeg?: number }} [opts]
 * @returns {import('./build-tiles.d.mts').BuildResult}
 */
export function buildTilesFromWays(ways, opts = {}) {
  const tileDeg = opts.tileDeg ?? TILE_DEG;
  const tiles = new Map();
  let wayCount = 0;
  for (const way of ways) {
    if (!way.coords || way.coords.length < 2) continue;
    const touched = new Set();
    for (const [lat, lng] of way.coords) {
      touched.add(`t_${Math.floor(lng / tileDeg)}_${Math.floor(lat / tileDeg)}`);
    }
    const coords7 = way.coords.map(([lat, lng]) => [r7(lat), r7(lng)]);
    for (const key of touched) {
      let tile = tiles.get(key);
      if (!tile) {
        tile = { ways: [] };
        tiles.set(key, tile);
      }
      tile.ways.push([way.id, coords7, way.tags]);
    }
    wayCount++;
  }
  return { tiles, wayCount, tileDeg };
}

function r7(value) {
  return Number(value.toFixed(7));
}

/** Serialize a built tile to the provider's on-disk JSON format (v2). */
export function tileToJson(tile) {
  return { v: FORMAT_VERSION, w: tile.ways };
}

// ---------------------------------------------------------------------------
// XML adapter (osmium-filtered or otherwise exported OSM XML)
// ---------------------------------------------------------------------------

function unescapeXml(s) {
  return s
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

export async function waysFromXml(xml) {
  // pass 1 — node id -> [lat, lng]
  const lats = [];
  const lngs = [];
  const idToIndex = new Map();
  for (const m of xml.matchAll(/<node\s[^>]*>/g)) {
    const open = m[0];
    const id = /id="(\d+)"/.exec(open)?.[1];
    const lat = /\blat="([-\d.]+)"/.exec(open)?.[1];
    const lng = /\blon="([-\d.]+)"/.exec(open)?.[1];
    if (id === undefined || lat === undefined || lng === undefined) continue;
    idToIndex.set(Number(id), lats.length);
    lats.push(Number(lat));
    lngs.push(Number(lng));
  }

  // pass 2 — ways with resolved coordinates
  const ways = [];
  for (const m of xml.matchAll(/<way\s[^>]*>[\s\S]*?<\/way>/g)) {
    const block = m[0];
    const id = Number(/id="(\d+)"/.exec(block)?.[1]);
    if (!Number.isFinite(id)) continue;
    const refs = [];
    for (const nd of block.matchAll(/<nd\s+ref="(\d+)"\s*\/>/g)) refs.push(Number(nd[1]));
    if (refs.length < 2) continue;
    const tags = {};
    for (const tag of block.matchAll(/<tag\s+k="([^"]*)"\s+v="([^"]*)"\s*\/>/g)) {
      const key = unescapeXml(tag[1]);
      if (KEEP_TAGS.has(key)) tags[key] = unescapeXml(tag[2]);
    }
    if (tags['highway'] === undefined) continue;
    const coords = [];
    for (const ref of refs) {
      const idx = idToIndex.get(ref);
      if (idx === undefined) {
        coords.length = 0;
        break; // node outside the extract — drop the way
      }
      coords.push([lats[idx], lngs[idx]]);
    }
    if (coords.length === 0) continue;
    ways.push({ id, coords, tags });
  }
  return ways;
}

export async function buildTilesFromXml(xml, opts) {
  return buildTilesFromWays(await waysFromXml(xml), opts);
}

// ---------------------------------------------------------------------------
// PBF adapter (pbf2json — precompiled binary from npm, no external tools)
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);

export async function waysFromPbf(pbfPath) {
  const pbf2json = require('pbf2json');
  const leveldb = await mkdtemp(join(tmpdir(), 'mtbr-pbf2json-'));
  try {
    const stream = pbf2json.createReadStream({
      file: pbfPath,
      tags: ['highway'],
      waynodes: true,
      leveldb,
    });
    const ways = [];
    await new Promise((resolve, reject) => {
      stream.on('data', (ev) => {
        if (ev.type !== 'way' || !Array.isArray(ev.nodes)) return;
        const tags = {};
        for (const [k, v] of Object.entries(ev.tags ?? {})) {
          if (KEEP_TAGS.has(k)) tags[k] = String(v);
        }
        if (tags['highway'] === undefined) return;
        ways.push({
          id: Number(ev.id),
          coords: ev.nodes.map((n) => [Number(n.lat), Number(n.lon)]),
          tags,
        });
      });
      stream.on('end', () => resolve());
      stream.on('close', () => resolve());
      stream.on('error', reject);
    });
    return ways;
  } finally {
    rmSync(leveldb, { recursive: true, force: true });
  }
}

async function buildTilesFromPbf(pbfPath, opts) {
  return buildTilesFromWays(await waysFromPbf(pbfPath), opts);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function streamFileToString(path) {
  const rl = createInterface({ input: createReadStream(path, 'utf8') });
  let content = '';
  for await (const line of rl) content += line;
  return content;
}

async function main() {
  const args = process.argv.slice(2);
  const input = args[0];
  const outDir = args[1];
  const regionIdx = args.indexOf('--region');
  const region = regionIdx !== -1 ? (args[regionIdx + 1] ?? 'custom') : 'custom';
  if (!input || !outDir) {
    console.error(
      'usage: node build-tiles.mjs <input.osm.pbf|input.osm.xml> <outputDir> [--region <name>]',
    );
    process.exit(1);
  }

  const t0 = Date.now();
  let result;
  if (input.toLowerCase().endsWith('.pbf')) {
    console.log(`reading ${input} via pbf2json (PBF)…`);
    result = await buildTilesFromPbf(input);
  } else {
    console.log(`reading ${input} (OSM XML)…`);
    const xml = await streamFileToString(input);
    console.log(`  ${(xml.length / 1e9).toFixed(2)} GB read`);
    result = await buildTilesFromXml(xml);
  }

  const { tiles, wayCount } = result;
  console.log(
    `kept ${wayCount.toLocaleString()} routable ways -> ${tiles.size} tiles in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  await mkdir(outDir, { recursive: true });
  let bytes = 0;
  for (const [key, tile] of tiles) {
    const json = JSON.stringify(tileToJson(tile));
    bytes += json.length;
    await writeFile(join(outDir, `${key}.json`), json);
  }

  await writeFile(
    join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        formatVersion: FORMAT_VERSION,
        tileDeg: TILE_DEG,
        region,
        generatedAt: new Date().toISOString(),
        source: 'OpenStreetMap data © OpenStreetMap contributors (ODbL), via Geofabrik extracts',
      },
      null,
      2,
    ),
  );

  await writeFile(
    join(outDir, '.htaccess'),
    [
      '# CORS + compression for the tile JSON files (Apache shared hosting)',
      'Header set Access-Control-Allow-Origin "*"',
      '<IfModule mod_deflate.c>',
      '  AddOutputFilterByType DEFLATE application/json',
      '</IfModule>',
      '',
    ].join('\n'),
  );

  console.log(
    `wrote ${tiles.size} tiles (${(bytes / 1e6).toFixed(1)} MB, ~${(bytes / 5e6).toFixed(0)} MB gzipped) + manifest.json + .htaccess to ${outDir}`,
  );
  console.log('upload the directory contents to your webspace and set the base URL in the app.');
}

// run as CLI (not when imported by tests)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
