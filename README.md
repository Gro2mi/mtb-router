# MTB Router

Mountain-bike route planner that runs entirely in the browser: tap waypoints on a map, they snap to
roads and trails, and routes are computed from **OpenStreetMap** data with a direction-aware
difficulty model (separate MTB & SAC bands for uphill and downhill, forest-road preference uphill).

**Status:** M1 in progress — E1 (scaffold & map foundation) done. See
[`docs/PLAN.md`](docs/PLAN.md) (product & architecture) and [`docs/EPICS.md`](docs/EPICS.md)
(epics & stories).

## Develop

```bash
npm install    # also compiles the i18n catalogs (prepare script)
npm run dev    # http://localhost:5173
```

## Checks

```bash
npm run lint        # ESLint
npm run typecheck   # svelte-check
npm run test        # Vitest unit tests
npm run test:e2e    # Playwright smoke tests (once: npx playwright install chromium)
npm run build       # production build to dist/
```

## Self-hosted map data (recommended for restricted networks)

By default the app loads corridor data from public Overpass servers (with an automatic fallback to
`api.openstreetmap.org`). If a **tiles folder is found** — see the deployment section below — it
becomes the **only** map-data source: a region that isn't in the build shows a clear error instead
of silently grinding the (possibly blocked) public servers. If no tiles folder exists, the public
chain is used as before.

**No external tools needed** — the builder reads Geofabrik `.osm.pbf` extracts directly (the PBF
reader ships as a precompiled binary through npm):

1. **Download an extract and build tiles** (example: Austria — `curl -L` is required, Geofabrik
   redirects `-latest` URLs to dated files):

   ```bash
   curl -L -O https://download.geofabrik.de/europe/austria-latest.osm.pbf
   node --max-old-space-size=6144 scripts/build-tiles/build-tiles.mjs \
     austria-latest.osm.pbf dist/tiles --region austria
   ```

   Country-sized builds need a few GB of RAM and a few minutes; small regions are quick
   (Liechtenstein: 14 600 ways → 8 tiles in 2 s). Austria yields roughly 2 000 tiles (a few hundred
   MB raw, far less with the included gzip config).

   Other European extracts (same pattern: `https://download.geofabrik.de/europe/<file>`; sizes
   approximate, they grow over time):

   | Region               | File                                          | ~Size  |
   | -------------------- | --------------------------------------------- | ------ |
   | Austria              | `austria-latest.osm.pbf`                      | 1.3 GB |
   | Germany              | `germany-latest.osm.pbf`                      | 4.2 GB |
   | Switzerland          | `switzerland-latest.osm.pbf`                  | 450 MB |
   | Italy                | `italy-latest.osm.pbf`                        | 1.9 GB |
   | France               | `france-latest.osm.pbf`                       | 3.8 GB |
   | Slovenia             | `slovenia-latest.osm.pbf`                     | 130 MB |
   | Slovakia             | `slovakia-latest.osm.pbf`                     | 350 MB |
   | Hungary              | `hungary-latest.osm.pbf`                      | 650 MB |
   | Czech Republic       | `czech-republic-latest.osm.pbf`               | 750 MB |
   | Croatia              | `croatia-latest.osm.pbf`                      | 400 MB |
   | Spain                | `spain-latest.osm.pbf`                        | 2.6 GB |
   | Portugal             | `portugal-latest.osm.pbf`                     | 1.1 GB |
   | Norway               | `norway-latest.osm.pbf`                       | 1.6 GB |
   | Sweden               | `sweden-latest.osm.pbf`                       | 1.6 GB |
   | Netherlands          | `netherlands-latest.osm.pbf`                  | 1.4 GB |
   | Belgium              | `belgium-latest.osm.pbf`                      | 550 MB |
   | Luxembourg           | `luxembourg-latest.osm.pbf`                   | 40 MB  |
   | Denmark              | `denmark-latest.osm.pbf`                      | 550 MB |
   | Poland               | `poland-latest.osm.pbf`                       | 1.5 GB |
   | Greece               | `greece-latest.osm.pbf`                       | 800 MB |
   | Iceland              | `iceland-latest.osm.pbf`                      | 50 MB  |
   | Ireland + N. Ireland | `ireland-and-northern-ireland-latest.osm.pbf` | 750 MB |
   | Great Britain        | `great-britain-latest.osm.pbf`                | 2.2 GB |

   (Full catalogue: [download.geofabrik.de](https://download.geofabrik.de/europe.html).)

   _Alternative:_ the builder also accepts osmium-filtered OSM XML
   (`build-tiles.mjs filtered.osm.xml …`). On Windows, osmium-tool is available via
   [conda-forge](https://anaconda.org/conda-forge/osmium-tool) or WSL (`apt install osmium-tool`);
   it is **not** required for the PBF path above.

2. **Upload** the contents of `dist/tiles/` (tiles, `manifest.json`, `.htaccess`) to your webspace.
   The generated `.htaccess` already sets CORS + gzip for Apache hosting.

3. **Point the app at it:** open the Route tab → _Self-hosted map data URL_ → e.g.
   `https://yourdomain.at/mtb-tiles` → Save. Data loads now come from your host first; public
   servers are only used for regions you haven't built.

**Verify the upload** (expect `HTTP/2 200` and `access-control-allow-origin: *` — the latter proves
the `.htaccess` made it onto the server; it is a hidden file, check your FTP client shows those):

```bash
curl -sI https://yourdomain.at/mtb-tiles/manifest.json | grep -iE "HTTP/|access-control"
```

**Local development without webspace** — serve the tiles through the Vite dev server by copying
them into `public/tiles/` (same origin, no CORS needed; `.htaccess` is irrelevant in dev):

```bash
mkdir -p public/tiles && cp dist/tiles/* public/tiles/
```

Then set _Self-hosted map data URL_ to `http://localhost:5173/tiles`. (Alternative: serve the
folder separately with `npx http-server dist/tiles -p 8080 --cors` and use
`http://localhost:8080`.)

Rebuild whenever you want fresher data (Geofabrik extracts update daily).

## Deploying the app + tiles together (single webspace)

One upload serves the app **and** the map data — the app auto-probes a `tiles/` or `mtb-tiles/`
folder next to `index.html` and at the domain root, so no setting is needed. The built app uses
**relative paths**, so it deploys to the domain root OR any subfolder (`mydomain.com/mtb-router/`)
without rebuilding:

```bash
npm run build          # app -> dist/  (Vite clears dist/, so build the app first)
node --max-old-space-size=6144 scripts/build-tiles/build-tiles.mjs   data/austria-latest.osm.pbf dist/tiles --region austria   # tiles -> dist/tiles/
```

Then upload the **contents of `dist/`** to your webspace root via SFTP/WinSCP:

```
index.html        <- the app
assets/…          <- app bundle
tiles/            <- manifest.json, t_*.json, .htaccess (CORS + gzip)
```

The layout is flexible — three working variants:

| App            | Tiles                  | Works?                                 |
| -------------- | ---------------------- | -------------------------------------- |
| `/mtb-router/` | `/mtb-router/tiles/`   | ✓ auto-discovered (next to index.html) |
| `/mtb-router/` | `/tiles` (domain root) | ✓ auto-discovered (root fallback)      |
| `/`            | `/tiles`               | ✓                                      |

An explicit URL in the Route tab always wins over auto-discovery (use it when the tiles live on a
different domain). Browsers open `/mtb-router` without the trailing slash → servers redirect to
`/mtb-router/` automatically (Apache does this by default) — always share the trailing-slash URL.

Notes:

- The generated `tiles/.htaccess` sets CORS + gzip; same-origin doesn't need CORS, but it keeps
  the folder usable as a manual-URL target from other origins.
- Ensure the domain has HTTPS active (IONOS: Domain → SSL) and verify:
  `curl -sI https://yourdomain.at/tiles/manifest.json` → `200`.
- Rebuild + re-upload the tiles folder when you want fresher OSM data.

## Own basemap tiles (optional — zero OpenFreeMap map traffic)

The map _display_ uses OpenFreeMap's hosted Bright style: every pan/zoom fetches vector tiles from
`tiles.openfreemap.org` (free, no key, no limits — this is normal slippy-map behavior and works
even on otherwise-blocked networks). If you want the map display **fully self-hosted** too, build
your own vector tiles from the same OSM data with [Planetiler](https://github.com/onthegomap/planetiler)
(needs Java 17+) and upload a single-file PMTiles archive:

```bash
java -Xmx4g -jar planetiler.jar --area=austria --download   # -> austria.mbtiles (~1–2 GB)
pmtiles convert austria.mbtiles austria.pmtiles             # pmtiles CLI: github.com/protomaps/PMTiles/releases
```

Upload `austria.pmtiles` to your webspace as **`tiles/basemap.pmtiles`** (next to `manifest.json`).
On startup the app probes for that file: present → the map renders from your archive; absent →
OpenFreeMap as usual. No rebuild or setting needed.

Notes:

- The archive covers the built region only (Austria) — planning elsewhere shows a plain background
  (routing likewise needs a matching tile build).
- Map **labels/fonts** still come from the hosted glyphs endpoint (a few small requests).
- OSM attribution stays in place (legally required, data © OpenStreetMap contributors).
- PMTiles needs HTTP **range requests** — supported by Apache/IIS by default; verify with
  `curl -sI -H "Range: bytes=0-100" https://yourdomain.at/tiles/basemap.pmtiles` (expect `206`).

## Offline & PWA

The app is an installable PWA: after opening it once, use your browser's **Install app** action
(address-bar icon / browser menu) for a standalone window with an app icon. A service worker
precaches the app shell and caches visited map data (basemap tiles, your corridor tiles,
elevation, contour-line DEM tiles) — visited regions and previously planned rides stay available
**offline**. New app versions activate automatically on the next online visit.

Contour lines (Settings → toggle) are rendered client-side from the same AWS Terrain Tiles the
elevation profile uses — no extra tile hosting or API key needed.

## Limitations

- Routing quality depends on OSM data: `mtb:scale` tags are sparse in some regions; untagged ways
  get a conservative inference (see the Difficulty tab legend).
- Node-level difficulty (crux spots) and per-country access rules are approximated.
- The corridor fetch radius is capped — extremely long detours outside the corridor need via
  points (the widening loop helps but has limits).
- Elevation and contour lines come from AWS Terrain Tiles; on networks that block AWS the
  elevation profile is unavailable (the route still works, with flat-cost estimates) and contour
  lines stay empty — both degrade independently of the routing itself.
- No turn-by-turn navigation — this is a planning tool.

## Attribution

- Map & routing data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL)
- Vector tiles hosted by [OpenFreeMap](https://openfreemap.org); map style: OpenFreeMap **Bright** with a high-visibility contrast pass (dedicated track/cycleway layers)
- Elevation: Mapzen / AWS Terrain Tiles (public domain)
