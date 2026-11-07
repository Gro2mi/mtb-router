# MTB Router — Epics & Stories

Status: **Approved draft** · Date: 2026-11-06 · Companion document: [`docs/PLAN.md`](./PLAN.md)

Sizes: **S** (< 1 day) · **M** (1–3 days) · **L** (≈ 1 week) · **XL** (multi-week, split into stories).
States: `todo` → `doing` → `done` (update this file as work progresses).

**Milestones**: M1 = E1–E3 core (routing demo) · M2 = E3.8 + E4–E6 (MVP) · M3 = E7 (hardening).

```
E1 ─▶ E2 ─▶ E3 ─▶ E4 ─▶ E5 ─▶ E6 ─▶ E7
       │      ▲
       └──────┘  (E3.3 cost model is pure TS — can start in parallel with E2)
```

---

## E1 — Scaffold & map foundation · M · M1 · deps: — · **done (2026-11-06)**

**Goal:** A running app shell with an OSM-based map that is pleasant to use with fingers and with a
mouse, in English and German.

> **Implementation notes (2026-11-06):** Package manager is **npm**, not pnpm (pnpm was not installed;
> the scripts are manager-agnostic). **maplibre-gl was upgraded to v6** (from v5) because of the
> critical XSS advisory GHSA-jrc7-96c5-q579 — v6 removed the default export (named imports now).
> Paraglide compiles with `--strategy localStorage --emit-ts-declarations`; the inlang settings use
> the `modules` (CDN) format that the current CLI generates. Prettier pinned to 3.5.x until
> prettier-plugin-svelte/tailwindcss support the 3.6+ plugin API.
> **maplibre-gl v6 worker fix:** v6 loads its worker via `new URL(..., import.meta.url)`, which
> breaks under Vite in dev (worker missing from `.vite/deps`) _and_ in the production bundle. Fix:
> `scripts/sync-maplibre-worker.mjs` (wired into `prepare`) copies the worker to `public/vendor/`
> and `createMap()` calls `setWorkerUrl()` pointing there. The e2e map test now asserts the style
> attribution loads, which would have caught the blank map. All checks green: lint, typecheck,
> 17 unit tests, 3 Playwright smoke tests, Lighthouse desktop performance 100 / accessibility 100.

| #   | Story                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Toolchain: Vite + TypeScript (strict) + Svelte 5 + Tailwind v4; ESLint + Prettier; scripts `dev`, `build`, `preview`, `test`, `lint`, `typecheck` (pnpm).                                 |
| 1.2 | Map view: MapLibre GL JS with OpenFreeMap _Liberty_ style; attribution control (OSM + OpenFreeMap); initial view Europe; last viewport persisted.                                         |
| 1.3 | Input parity: pointer-event abstraction for tap / long-press / drag; MapLibre touch gestures (pan, pinch, rotate) + mouse wheel + keyboard navigation; suppress default browser gestures. |
| 1.4 | App shell: mobile-first fullscreen map + bottom sheet (collapsed/expanded) with safe-area insets; ≥ lg breakpoint shows side drawer instead; dark/light follows system.                   |
| 1.5 | Geolocation: "locate me" button, permission handling, graceful denial.                                                                                                                    |
| 1.6 | i18n: paraglide (inlang) setup with EN + DE catalogs, persisted language switcher; **every** UI string routed through i18n from day one.                                                  |
| 1.7 | Test base: Vitest + Playwright configs; one trivial unit test; Playwright smoke: app loads, map canvas present, language switch works.                                                    |

**Acceptance criteria**

- `pnpm dev` serves the app; map pans/zooms without jank on desktop and in mobile emulation.
- All UI strings localized EN + DE; choice survives reload.
- Lighthouse (desktop) performance ≥ 90 on the shell.
- `pnpm lint`, `typecheck`, `test` all green.

---

## E2 — Waypoints & snapping · L · M1 · deps: E1 · **done (2026-11-06)**

**Goal:** Komoot-like waypoint editing with snap-to-way and the OSM corridor fetch that powers it.

> **Implementation notes (2026-11-06):** All seven stories delivered. Module layout:
> `src/lib/osm/` (tags/routability, corridor keys+queries, Overpass client, IDB cache, snap index),
> `src/lib/waypoints/store.svelte.ts` (reactive store + undo/redo), `src/lib/state/planning.svelte.ts`
> (mode, corridor pipeline, snap radius), `src/lib/map/waypointLayer.ts` (markers/handles/popup),
> UI: `Fab.svelte`, `StatusPill.svelte`, sheet Route-tab controls. Notes: (1) the Overpass fetch runs
> on the main thread in E2 — E3 moves it into the engine worker; (2) `insert-via` handles sit at leg
> midpoints on the straight line until route geometry exists (E3 will place them on the route);
> (3) MapLibre uses 512 px vector tiles — m/px at zoom z is half the classic 256 px math (matters for
> e2e click geometry); (4) busFactor: corridor cache re-fetch is suppressed by comparing quantized
> polyline keys (direction-normalized, so reversing reuses the corridor). Bug found by tests:
> `footway` was missing from `ALLOWED_HIGHWAYS`, breaking the bike-permitted/segregated escape hatch.
> Checks: lint, typecheck, 60 unit tests, 10 e2e (3 smoke + 7 waypoint, Overpass mocked) all green.
>
> **Follow-up fixes (2026-11-06, user feedback):** (1) _Waypoints below insert handles_ — MapLibre
> markers stack in DOM order; handles are now created before waypoints and both get explicit
> z-index classes (`:has()` selectors in app.css). (2) _Points never snapped on the user's
> network_ — **all public Overpass mirrors are unreachable from their machine** (TCP black-hole;
> verified: overpass-api.de/kumi/private.coffee hang, osm.ch is Swiss-only, mail.ru 504s). Added
> `src/lib/osm/osmApiFallback.ts`: when every mirror fails, the corridor is fetched from
> `api.openstreetmap.org/api/0.6/map` (different infrastructure, CORS OK) via capped adaptive
> bboxes (~1.3 km, quadrant-split on the 50 k-node limit, throttled ≤ 2 req/s) parsed with a
> DOM-free regex XML parser (worker-ready). Overpass client now uses tiered attempt timeouts
> (10/25/45 s) + sticky preferred mirror so dead hosts fail over fast. Status pill shows the
> fallback stage; corridor errors gained a hint line. Verified live on the user's network:
> 3 095 ways / 88 317 nodes near Innsbruck, snapping OK. Totals now: 67 unit tests, 11 e2e.
>
> **Self-hosted static tiles (2026-11-06, user request — first slice of the PLAN §3 "prebuilt graph
> tiles" backend):** `scripts/build-tiles/build-tiles.mjs` (pure Node, no native deps) converts
> osmium-filtered OSM XML into 0.1° tiles of routable ways + nodes (tag whitelist covers E2 snapping
> and the E3 cost model; tiles are self-contained, consumers dedupe by id), plus `manifest.json`,
> `.htaccess` (CORS + gzip for Apache webspace like IONOS) and a README upload guide. App side:
> `src/lib/osm/staticTiles.ts` runs as **stage 0** before Overpass — configured via the Route tab
> "Self-hosted map data URL" (localStorage). 404 tiles count as empty (region edges); a fully-missed
> corridor or server errors fall through to the Overpass → OSM API chain. Same tiles will feed the
> E3 graph builder. Round-trip tested: XML → builder → provider merge → snap index. Totals now:
> 77 unit tests, 12 e2e.
>
> **Tile format v2 + direct PBF input (2026-11-06):** the builder now reads Geofabrik `.osm.pbf`
> extracts **directly via `pbf2json`** (precompiled Go binary shipped through npm — no osmium or
> other native tools needed; osmium-XML remains an alternative input). Tiles switched to inline
> coordinates (`{"v":2,"w":[[wayId,[[lat,lng],…],tags],…]}`); the provider synthesizes node ids
> from coordinate keys so junctions stay shared across ways/tiles (E3 graph stitching). Verified
> live: Liechtenstein PBF → 8 tiles/3.9 MB in 1.8 s → corridor 4 632 ways → snap OK. Note:
> Geofabrik `-latest` URLs 307-redirect — downloads need `curl -L`. Totals now: 78 unit tests,
> 12 e2e.

| #   | Story                                                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | Waypoint model & store: ordered list with roles start/via/end, Svelte-5 reactive store, derived route-request shape.                                                                                                                                                                               |
| 2.2 | Planning interaction: FAB toggles plan mode (tap adds waypoint); long-press adds in browse mode; desktop right-click menu; second tap onward chains vias; first waypoint = start, every addition extends.                                                                                          |
| 2.3 | Corridor + Overpass client: buffered polyline (default 2 000 m) → two-stage Overpass query (PLAN §8), mirror fallback, timeout, progress + error UI; corridor cached in IndexedDB keyed by quantized polyline + radius + schema version.                                                           |
| 2.4 | Routability & access filter v1 (PLAN §7.7) as shared pure module (used later by graph builder).                                                                                                                                                                                                    |
| 2.5 | Snapping: uniform-grid spatial index over way segments, point→segment projection within snap radius (default 50 m, configurable 10–200 m); snapped marker + rubber-band line; no hit within radius → unsnapped waypoint with warning. First tap in unloaded region: fetch-then-snap with progress. |
| 2.6 | Editing: drag marker with throttled live re-snap; midpoint "insert via" handle on legs; long-press/context delete; reverse route; clear all.                                                                                                                                                       |
| 2.7 | Undo/redo stack covering all waypoint operations (`Ctrl+Z`/`Ctrl+Y`).                                                                                                                                                                                                                              |

**Acceptance criteria**

- A tap ≤ 50 m from a road/trail snaps to it; snap feedback renders < 150 ms on cached corridor.
- Corridor fetch shows progress and errors with retry; identical re-plan issues no new Overpass request.
- Every editing gesture works with touch **and** mouse/keyboard.
- Undo/redo returns to any prior waypoint state exactly.

---

## E3 — Routing engine & difficulty cost model · XL · M1/M2 · deps: E2 (E3.3 parallelizable after E1) · **done (2026-11-06), 3.8 calibration open (M2)**

**Goal:** The product's core — an in-worker engine that builds a routable graph from Overpass data and
computes routes under the direction-aware difficulty model (PLAN §7).

| #   | Story                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ----- | ----------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| 3.1 | Engine worker skeleton: message protocol `loadCorridor                                                                                                                                                                                                                                                                                                                                     | setSettings | route | cancel`→`progress | result | error`(shared types in`src/engine/protocol.ts`); typed-array graph layout (CSR adjacency, node coords + elev). |
| 3.2 | Overpass parser: JSON → ways/nodes; tag extraction to compact attribute records (enums/bitfields: highway class, surface, tracktype, difficulties, access incl. `:forward/:backward`); handle `mtb:scale` suffixes (`2+`); keep topology (no geometry loss at this stage).                                                                                                                 |
| 3.3 | **Cost model (pure TS, no DOM):** implements PLAN §7 in full — effective difficulty per direction, untagged inference table, hard max / soft min band semantics, SAC bands, forest-road uphill boost, singletrail uphill penalty, push/carry walking model, base speed & gradient tables. Exported as `costFor(wayAttrs, slope, settings) → {costFwd, costBwd, excludedFwd, excludedBwd}`. |
| 3.4 | Graph builder: split ways at shared nodes; drop isolated components; per-edge attrs + length + Δz slot; snap index (nodes + edge-split virtual nodes).                                                                                                                                                                                                                                     |
| 3.5 | Elevation service: terrarium tile fetch + decode in worker (OffscreenCanvas), bilinear sampling per node, IndexedDB tile cache, `incline` fallback, degraded-mode flag.                                                                                                                                                                                                                    |
| 3.6 | Router: bidirectional A\* (binary heap, straight-line/min-cost heuristic) over per-direction costs; leg sequencing across waypoints; cancellation; no-path detection → **corridor widening loop 2→5→10 km** with progress states.                                                                                                                                                          |
| 3.7 | Result assembly: per-leg polyline with per-segment attrs (effective difficulty + tagged/inferred flag, surface, class); stats aggregation hooks (distance, ascent/descent, moving time, km per difficulty).                                                                                                                                                                                |
| 3.8 | Calibration (M2): tune base speeds / climb rates / downhill caps against 3–5 known local routes; record as regression fixtures.                                                                                                                                                                                                                                                            |

**Acceptance criteria**

- Cost model unit tests: ≥ 30 fixture cases — forest road preferred uphill, S-max exclusion per
  direction, soft-min penalty, SAC exclusion, inference table rows, access cases, steps-as-portage,
  `2+` parsing. All table-driven in `tests/fixtures`.
- 30 km route: < 2 s warm (cached corridor), < 6 s cold incl. fetch on desktop; main thread never
  blocked (all engine work in worker; measurable: no long tasks > 50 ms during routing).
- Demonstrate corridor widening: a leg failing at 2 km succeeds automatically at 5 km with visible status.
- `avoidUntaggedSingletrail` and `forestRoadPreference` demonstrably change uphill route choice on a
  fixture region.

> **Implementation notes (2026-11-06):** Stories 3.1–3.7 done (3.8 calibration pending, M2).
> Module layout: `src/engine/protocol.ts` (typed worker messages + RouteResult), `src/engine/cost/model.ts`
> (pure cost model, all tuning constants in one exported `COST` object for E3.8), `src/engine/graph/build.ts`
> (CSR typed arrays, oneway incl. `oneway:bicycle=no` exemption, largest-component filter), `src/engine/router/astar.ts`
> (bidirectional A\*, binary heap, epoch-stamped scratch arrays, virtual waypoint nodes with edge
> splitting — stubs always pass so a waypoint on a band-excluded way still routes from there),
> `src/engine/router/route.ts` (leg chaining, hop decoding, stats + km-per-difficulty buckets),
> `src/engine/elevation/terrarium.ts` (OffscreenCanvas decode, bilinear sampling, IDB cache, 6 s
> hang-guard + session degradation memo), `src/engine/worker.ts` (plan pipeline with the
> 2→5→10 km widening loop; single-waypoint plans deliberately skip widening), `src/engine/host.ts`.
> UI: route drawn as a basic cased line (`routeLayer.ts`, styling in E5), drawer Route tab shows
> distance/ascent/time, status pill gained elevation + widening + per-error-code messages.
> E2's main-thread corridor/snap orchestration was replaced by the worker; snap probes are now
> async round-trips (`layer.onProbeResult`). Also: `parseStage` exported for tests, gesture
> classifier now classifies long holds at pointerup (interval ticks can be delayed under load —
> this was the mobile e2e flake). Bugs caught by tests: missing `effectiveDifficulty` import,
> hop-spread key mismatch (null coords), cost arrays hold ±Infinity for excluded segments (stub
> costs need a walking-pace fallback). Elevation: AWS s3 may be unreachable on restricted
> networks — degraded mode (flat slopes, ascent shown as "–") covers it. Totals: 133 unit tests,
> 13 e2e, lint + typecheck + build green.

---

## E4 — Difficulty preference UI · M · M2 · deps: E3 · **done (2026-11-06)**

> **Implementation notes (2026-11-06):** `src/lib/ui/presets.ts` (pure presets + `matchPreset` +
> `clampBand`, unit-tested), `RangeSlider.svelte` (two stacked native ranges, keyboard accessible,
> accent selection band), `Difficulty.svelte` (uphill/downhill MTB+SAC dual sliders, 4-step forest
> preference, untagged toggle, scale education block), planning store gained reactive `settings` +
> `setSettings` (300 ms debounce → worker `reroute`, no refetch). **Key gotcha:** Svelte `$state`
> proxies are not structured-cloneable — the plan message carried a proxy and `postMessage` threw,
> silently killing every worker plan; fixed with `$state.snapshot` at the worker boundary. Worker
> reroute reuses the loaded graph/snaps. E2E covers reroute-without-refetch (Overpass counter),
> hard-limit exclusion surfacing as `no_route` error, and preset recovery. Note: route segment
> _coloring_ by difficulty (making limit changes visible on the map) lands with E5 rendering.

**Goal:** Make the difficulty model tangible and tweakable with one hand.

| #   | Story                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | Settings panel (sheet page / drawer tab): **Uphill** — dual-handle sliders MTB 0–5 (captions "rideable → push/carry") and SAC T1–T6; **Downhill** — MTB 0–6 (S0–S6) and SAC T1–T6; forest-road preference 4-step control; all targets ≥ 44 px. |
| 4.2 | Presets: Easy cruise / All-mountain / Enduro tech (PLAN §7.2) + save/rename/delete custom presets.                                                                                                                                             |
| 4.3 | Live reroute: settings changes debounced 300 ms → recompute costs + reroute (no refetch); routing status indicator; waypoints unchanged.                                                                                                       |
| 4.4 | Education & safety: inline explanations of S/T scales and hard-vs-soft limits; `avoid untagged singletrail` toggle; legend for tagged vs inferred difficulty.                                                                                  |

**Acceptance criteria**

- Lowering downhill MTB max from 4 to 2 visibly removes S3+ segments from the route.
- Raising forest-road preference shifts uphill legs onto forest roads in the fixture region.
- One-handed operation on a 360 px-wide viewport; EN + DE complete.

---

## E5 — Route display, stats & elevation profile · L · M2 · deps: E3 (full value with E4) · **done (2026-11-07)**

> **Implementation notes (2026-11-07):** (5.1) per-segment colored rendering: RouteSegment gained
> `difficulty` (effective MTB level in travel direction, computed in buildSegment from dirDz with a
> 0.5 m climb threshold), `walking`, `slope` — all optional (legacy stored routes render with a
> max(scale) fallback); routeLayer rewritten as data-driven `line-color: ['get','color']` features
> plus a separate dashed gray layer for walking edges (line-dasharray is not data-driven);
> zoom-to-fit on worker routes only (routeVersion counter), reduced-motion respected.
> (5.2) segment popup on line click (class/surface/MTB S-level tagged-vs-estimated/walking note)
>
> - difficulty-split chips + walking km + max slope in the Route tab. (5.3) canvas elevation
>   profile colored per segment, pointer scrub ↔ map marker two-way sync
>   (`src/lib/profile/profileData.ts` pure builder, `profileState` in
>   `src/lib/state/profile.svelte.ts`), highlight band from segment clicks.
>   **Bugs found:** (a) worker never computed `seg.dz` after elevation attach (masked by manual test
>   setup) — fixed in the worker pipeline; (b) **elevation abort poisoning**: a superseded plan's
>   AbortError marked the whole session degraded — fixed to ignore AbortError, timeout raised to 10 s;
>   (c) **maplibre v6 Marker.\_update runs inside addTo** and reads the unset lngLat — the throw lands
>   AFTER appendChild, so `setLngLat` must be called BEFORE `addTo` (six orphaned scrub markers were
>   the symptom); (d) the worker route can beat the map 'load' event, so e2e must poll for layers.
>   Tests: e5 unit suite (colors, profile builder incl. joint dedupe + interpolation, degraded flag),
>   5 e2e (colors/walk layer, profile scrub → map dot, segment popup via projected click, legend +
>   breakdown, custom presets). 176 unit + 26 e2e green.

**Goal:** Present the route so the rider can judge it — line, numbers, profile.

| #   | Story                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | Route rendering: GeoJSON source; casing + line layers; per-segment difficulty coloring (tagged/inferred shading) + legend; zoom-to-fit.                                     |
| 5.2 | Stats: distance, ascent, descent, moving time, max slope; per-difficulty breakdown (km per S-level); tap segment → popup (class, surface, difficulty, source tag/inferred). |
| 5.3 | Elevation profile: canvas profile in the sheet, slope/difficulty coloring, two-way sync — scrub profile ↔ marker on map; tap route segment → jump profile.                 |
| 5.4 | UX polish: route change animations kept minimal (respect reduced-motion), stats update instantly after reroute.                                                             |

**Acceptance criteria**

- Ascent/descent within ±10 % of Komoot/BRouter on 3 reference routes.
- Profile↔map scrubbing at 60 fps with touch and mouse.
- Legend + segment popups make tagged vs inferred difficulty visible.

---

## E6 — Save/load & GPX export · M · M2 · deps: E5 · **done (2026-11-06), done before E5 (see note)**

> **Implementation notes (2026-11-06):** Implemented **before E5** — all three stories need only the
> E3/E4 data (RouteResult, settings, waypoints), not E5's rendering; the load-flow restores stats and
> a basic route line already. Modules: `src/lib/routes/serialization.ts` (StoredRoute + round-trip +
> sameGeometry + slugify), `src/lib/routes/routeStore.ts` (CRUD over an injectable RouteKv — real
> IDB `routes` store [DB v3] in the app, MemoryRouteKv in tests), `src/lib/gpx/gpx.ts` (pure GPX 1.1
> builder: one trkseg per leg, joint-point dedupe, `<ele>` omitted in degraded mode, XML-escaped),
> `src/lib/gpx/download.ts` (Blob download + Web Share API when the platform can share files),
> `src/lib/routes/routeLibrary.svelte.ts` (UI orchestration), `RoutesTab.svelte` (save with name,
> list with load / GPX / rename / duplicate / delete), settings persistence in
> `settingsPersist.ts` (localStorage — **deviation**: epic said IDB `settings`; synced hydration at
> module init avoids a double worker plan on startup, viewport/locale were already localStorage).
> Load flow: restore settings (no reroute) → waypoints.restore() (App effect replans; corridor is
> IDB-cached) → saved geometry seeded for instant display → viewport flyTo.
> **Bug class worth remembering (3rd occurrence):** reactive `$state` proxies cross every
> serialization boundary — `structuredClone(proxy)` throws DataCloneError, and here it was _silently
> swallowed_ by the IDB put's best-effort catch (save + rename both no-oped). Fixes:
> `$state.snapshot()` in saveCurrent and a JSON deep-clone inside the IDB put boundary. Also: Svelte
> bind:value sets properties, not attributes — `input[value=…]` CSS doesn't match in Playwright.
> E2E: save→reload→load (stats + snapped waypoints restored), GPX download content assertions,
> rename/delete. 159 unit + 20 e2e green.
>
> **E4.2 custom presets (2026-11-07, leftover):** save/rename(delete)-current-settings as named
> presets — `matchCustomId` in presets.ts, `customPresets.svelte.ts` (localStorage), chips with
> per-preset ✕ in the Difficulty panel, active state via exact-settings match. Fourth instance of
> the proxy lesson: `applyCustom` structured-cloned a deep proxy from the presets list —
> `$state.snapshot` before apply; the IDB put deep-clones defensively.

**Goal:** Routes survive reload and ride on a bike computer.

| #   | Story                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | Route store: IndexedDB `routes` (name, timestamps, waypoints, snapped positions, settings, geometry, stats); list UI with load / rename / duplicate / delete; loading restores map view + settings + route. |
| 6.2 | GPX export: GPX 1.1 `<trk>` with `<name>`, `<trkpt lat/lon/ele>`, `<wpt>` per waypoint; Blob download + Web Share API on mobile; schema-valid golden-file test.                                             |
| 6.3 | Settings persistence: rider settings, custom presets, last viewport, locale in IndexedDB `settings`.                                                                                                        |

**Acceptance criteria**

- Save → reload → load restores an identical route (geometry byte-equal after round-trip).
- Exported GPX imports correctly into two reference tools (e.g. Garmin Connect and Komoot), including
  elevations.
- Export works on iOS Safari and desktop browsers.

---

## E7 — Hardening & polish · M · M3 · deps: E1–E6

**Goal:** Make it dependable enough to rely on in the field.

| #   | Story                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | PWA: manifest + service worker (app-shell precache; tiles & elevation cache-first with LRU; Overpass never cached by SW — engine IDB cache handles it); installable; saved routes viewable offline. |
| 7.2 | Performance & memory: enforce budgets (PLAN NFR-2/3) — corridor caps, graph size instrumentation, release on clear; worker memory profiling; map style trim.                                        |
| 7.3 | Robustness: Overpass mirror list with health fallback; throttle + "Overpass busy" state; partial-corridor merge; error taxonomy with friendly i18n messages; global error boundary.                 |
| 7.4 | Accessibility & keyboard: ARIA on sliders/sheet/menus, focus management, contrast audit, reduced-motion respected everywhere.                                                                       |
| 7.5 | Docs: README (setup, usage, architecture summary, OSM/attribution notes, limitations, license TODO), inline docs for the cost model referencing PLAN §7.                                            |

**Acceptance criteria**

- Lighthouse: installable PWA; a11y ≥ 90; performance ≥ 90 desktop.
- Airplane-mode reload shows a previously saved route with profile and stats.
- A newcomer can run the app locally within 10 minutes using only the README.

---

## Traceability

| Requirement                                                | Covered by                              |
| ---------------------------------------------------------- | --------------------------------------- |
| FR-1 browser, no backend                                   | E1 (static build), E3 (worker engine)   |
| FR-2 touch + desktop                                       | E1.3/1.4, E2.2/2.6, E4.1                |
| FR-3 snap-to-way points                                    | E2.2, E2.5                              |
| FR-4 OpenStreetMap data                                    | E2.3, E3.2, PLAN §8                     |
| FR-5 per-direction MTB + SAC bands with lower/upper limits | E3.3 (semantics), E4.1 (UI)             |
| FR-6 uphill prefers forest roads                           | E3.3 (`forestBoost`), E4.1 (control)    |
| FR-7 GPX export                                            | E6.2                                    |
| FR-8 elevation profile & stats                             | E3.5, E5.2/5.3                          |
| FR-9 save & load routes                                    | E6.1/6.3                                |
| FR-10 EN/DE i18n                                           | E1.6 (all epics add strings through it) |

---

## Loading-speed fix — blocked networks (2026-11-07, user report "stuck in loading loop")

**Diagnosis:** on a network that black-holes Overpass, every corridor load burned the full
tiered timeout ladder (3 mirrors × 2 stages ≈ 160 s) before the OSM API fallback started — and
nothing remembered the failure, so **every new waypoint (new corridor key) repeated it**. The
widening loop (2→5→10 km) tripled it, and the route waited for a 10 s elevation hang (AWS s3
also blocked) before displaying anything.

**Fixes:**
- Overpass mirrors now **race in parallel** (Promise.any, first success wins, losers aborted)
  with one timeout per stage (15 s trails / 45 s roads) instead of escalating per-mirror waits;
- per-mirror **cooldown** (5 min) after a failure plus a global **Overpass cooldown** — once all
  mirrors fail, subsequent corridors skip Overpass entirely and go straight to the OSM API
  (superseded-plan aborts do not set cooldowns);
- OSM API fallback: boxes enlarged 0.012°→0.02°, cap 24→64, **global box dedupe** (consecutive
  anchors share grid cells — the cap previously starved later segments);
- worker reorder: **route is computed and posted FIRST** (flat costs), elevation is fetched
  afterwards and the route is recomputed + re-posted with climb-aware costs — the line appears
  immediately even when elevation is slow or blocked; the "Loading elevation…" pill no longer
  flashes when elevation is known-degraded;
- tile host diagnostics: console warnings when the tile build's manifest is an old format, the
  region isn't covered, or the host is unreachable.

**Testing:** overpassCooldown unit suite (mirror race, black-hole fallback, cooldown skip +
expiry, dual-source failure) with fake timers; e2e stabilized for the two-phase route post
(flat → elevation-refined): popup/scrub tests wait for a stable route via `waitForStableRoute`,
the popup click exits plan mode (a plan-mode click adds a waypoint), the waypoints suite waits
for map style readiness, and the cache test asserts the second undo/redo cycle issues zero
requests. 181 unit + 26 e2e green.

**Recommendation for blocked networks:** self-hosted tiles (stage 0) remain the only instant
path — rebuild tiles with the current builder (format v2) and set the URL in the Route tab;
diagnostics now warn when the build is stale.
