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

The app normally loads corridor data from public Overpass servers (with an automatic fallback to
`api.openstreetmap.org`). If those are blocked on your network — or you want instant loads — host
the data yourself on any static webspace (e.g. IONOS). **No external tools needed** — the builder
reads Geofabrik `.osm.pbf` extracts directly (the PBF reader ships as a precompiled binary through
npm):

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

## Attribution

- Map & routing data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL)
- Vector tiles hosted by [OpenFreeMap](https://openfreemap.org)
- Elevation: Mapzen / AWS Terrain Tiles (public domain)
