# MTB Router — Product & Technical Plan

Status: **Approved draft** · Date: 2026-11-06 · Companion document: [`docs/EPICS.md`](./EPICS.md)

---

## 1. Vision

A browser-based **mountain-bike route planner** with a Komoot/Outdooractive-like interaction model: tap
waypoints on a map, they snap to the nearest road or trail, and a route is calculated from
**OpenStreetMap data** — fully in the browser, with no backend.

The differentiator: a **direction-aware difficulty model**. The rider defines, _separately for uphill and
downhill_, which difficulties they prefer and accept — in **MTB scale** (`mtb:scale` / `mtb:scale:uphill`)
_and_ **hiking scale** (`sac_scale`), each with a lower (soft preference) and upper (hard limit) bound.
Uphill, the router **prefers rideable terrain** such as forest roads.

Target user: the author (avid MTB rider), family & friends. Not a product; no accounts, no telemetry.

### Goals

- Plan MTB rides on any device: touch-first UI (phones/tablets) with full desktop parity.
- Route respects rider-specific difficulty bands per direction (MTB + SAC, lower + upper limit).
- Uphill favors forest roads / rideable terrain; downhill can favor singletrail.
- 100 % OpenStreetMap data, properly attributed.
- Local-first: runs as a static site (local dev now, static hosting later without code changes).

### Non-goals (MVP)

- No user accounts, no cloud sync, no server component.
- No turn-by-turn navigation (planning tool, not guidance).
- No own map rendering; third-party vector tiles.
- No share-via-URL (backlog).

---

## 2. Requirements

| ID    | Requirement                                                                                                                                              | Source     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| FR-1  | Runs in the browser (static site, no backend)                                                                                                            | user       |
| FR-2  | Touch-optimized UI that also works on desktop                                                                                                            | user       |
| FR-3  | User selects points on the map; they snap to the closest road/trail (Komoot-like)                                                                        | user       |
| FR-4  | Routing uses OpenStreetMap data                                                                                                                          | user       |
| FR-5  | Difficulty preference **separately for uphill and downhill**, in **MTB difficulty** and **hiking difficulty (SAC)**, each with **upper and lower limit** | user       |
| FR-6  | Uphill prefers rideable terrain (forest roads)                                                                                                           | user       |
| FR-7  | GPX export                                                                                                                                               | user (MVP) |
| FR-8  | Elevation profile & ascent/descent stats                                                                                                                 | user (MVP) |
| FR-9  | Save & load multiple named routes locally                                                                                                                | user (MVP) |
| FR-10 | UI in English and German (i18n from start)                                                                                                               | user       |

Non-functional:

- NFR-1 Routing never blocks the main thread (Web Workers).
- NFR-2 Route 30 km in < 2 s warm (cached corridor), < 6 s cold on a desktop-class machine.
- NFR-3 Memory budget < 500 MB for a ≤ 50 km route corridor.
- NFR-4 All caching local (IndexedDB); offline view of saved routes after PWA hardening (E7).
- NFR-5 OSM attribution displayed in-map and in an About section (legal requirement).

---

## 3. Architecture decision (confirmed with user)

**Browser-only engine.** OSM data is fetched live via the **Overpass API** in a _corridor_ around the
planned route, the routing graph is built in a **Web Worker**, and routing (bidirectional A\*) runs in the
same worker with a fully custom, unit-tested **difficulty cost model** in TypeScript.

Alternatives considered and rejected (for now):

| Option                                                                    | Why not now                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-hosted BRouter + custom profile                                      | Battle-tested and fast, but requires a 24/7 host (user chose local-only) and the difficulty model is constrained by BRouter's profile scripting.                                                  |
| Prebuilt graph tiles (Geofabrik extract → binary tiles on static hosting) | Best long-term performance/robustness, most infra upfront. Kept as a drop-in future path: the engine interface (`loadCorridor → route`) is designed so a tile backend can replace Overpass later. |

Deployment: **local dev only** for now (`pnpm dev`). The build output is a static bundle, so moving to
GitHub Pages/Netlify later is a config change, not a code change.

---

## 4. Tech stack

| Layer          | Choice                                             | Rationale                                                                                 |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Language       | TypeScript (strict)                                | Type-safe cost model & graph structures                                                   |
| Build          | Vite                                               | Fast dev server, first-class worker & Svelte support                                      |
| UI framework   | Svelte 5                                           | Small runtime, runes-based reactive stores, great for gesture-heavy UIs                   |
| Map            | MapLibre GL JS (v5)                                | Open-source WebGL vector maps, excellent touch + mouse support                            |
| Basemap        | OpenFreeMap (Liberty style)                        | Free OSM vector tiles, no API key, no limits ([openfreemap.org](https://openfreemap.org)) |
| Styling        | Tailwind CSS v4                                    | Rapid responsive/overlay UI work                                                          |
| i18n           | paraglide JS (inlang)                              | Compile-time, type-safe, tiny; EN + DE catalogs                                           |
| Routing engine | Custom, in Web Worker                              | Full control of the difficulty model (the product's core)                                 |
| OSM data       | Overpass API (public mirrors)                      | No infrastructure; corridor-limited queries                                               |
| Elevation      | AWS Terrain Tiles ("terrarium" PNG, public domain) | Free, key-less, decodable in-worker                                                       |
| Storage        | IndexedDB (via `idb`)                              | Corridor + elevation tile caches, routes, settings                                        |
| Tests          | Vitest (unit/integration), Playwright (E2E smoke)  | Cost model = pure TS → heavily unit-testable                                              |

---

## 5. System overview

```
┌─────────────────────────────── Browser ───────────────────────────────────┐
│                                                                           │
│  Main thread                          Engine Worker                       │
│  ┌──────────────────────┐   protocol   ┌────────────────────────────────┐ │
│  │ Map (MapLibre GL)    │  loadCorridor│ Overpass client (fetch)        │ │
│  │ Waypoint layer/markers│────────────▶│  ↳ mirror fallback, throttle   │ │
│  │ Route layer (GeoJSON)│  setSettings │ Corridor cache (IndexedDB)     │ │
│  │ Elevation profile    │────────────▶ │ Parser → ways/nodes            │ │
│  │ Bottom sheet UI      |   route      │ Graph builder (CSR, typed arr.)│ │
│  │  ↳ difficulty prefs  │────────────▶ │ Elevation svc (terrarium, IDB) │ │
│  │  ↳ stats, presets    |   cancel     │ Cost model (difficulty bands)  │ │
│  │ Persistence (routes, |◀─────────────│ Router (bidirectional A*)      │ │
│  │  settings) via IDB   |  progress/   │  ↳ corridor widening loop      │ │
│  └──────────────────────┘  result      └────────────────────────────────┘ │
│                                                                           │
│  IndexedDB: corridors · elevationTiles · routes · settings                │
└───────────────────────────────────────────────────────────────────────────┘
        External: OpenFreeMap tiles · Overpass mirrors · AWS terrain tiles
```

Module boundaries (package folders later, folders first):

- `src/map/` — MapLibre setup, layers, marker rendering, camera helpers
- `src/waypoints/` — waypoint store, planning-mode interaction, snapping UI
- `src/engine/` — worker host + message protocol
- `src/engine/protocol.ts` — shared message/result types (imported by both sides)
- `src/engine/overpass/` — query builder, fetch, mirrors
- `src/engine/graph/` — parser, access filter, graph builder, spatial index
- `src/engine/cost/` — **pure cost model + difficulty inference** (no DOM; 100 % unit-tested)
- `src/engine/router/` — A\*, leg sequencing, widening loop
- `src/engine/elevation/` — terrarium decode + sampling
- `src/state/` — UI stores (settings, routes, undo/redo)
- `src/i18n/` — paraglide message catalogs (en, de)
- `tests/fixtures/` — Overpass JSON fixtures, cost-model tag fixtures, GPX golden files

---

## 6. Data flow: from tap to route

1. **Tap** (plan mode, or long-press in browse mode) → raw point added to waypoint store.
2. **Corridor**: for all consecutive waypoint pairs, a polyline buffer (default **2 000 m**) defines the
   corridor. Corridor is quantized (≈100 m grid) for cache identity.
3. **Overpass fetch**: two-stage query (trails/tracks first for early results, connector roads second),
   see §8. Corridor responses cached in IndexedDB keyed by `hash(quantized polyline, radius, schemaVersion)`.
4. **Parse & filter**: ways → compact attributes (enums/bitfields: highway class, surface, tracktype,
   difficulty tags, access); bicycle access rules v1 applied (§7.7).
5. **Graph build**: ways split at shared nodes; CSR adjacency (typed arrays); node coordinates + elevation.
6. **Elevation**: terrarium tiles covering corridor bbox fetched/decoded (worker), bilinear sample per
   node → per-edge Δz. `incline` tag as fallback hint only.
7. **Snap** waypoints to graph (nearest edge projection within snap radius, default 50 m).
8. **Route**: per-direction edge costs from cost model + current settings; bidirectional A\* per leg;
   on failure → corridor widening (2 → 5 → 10 km) with visible status.
9. **Result**: per-segment polyline with attributes (difficulty, surface, class) → GeoJSON to map,
   stats + profile to UI, persisted with the route.

On settings change: only cost recompute + re-route (no refetch). On waypoint drag: re-snap + re-route
affected legs (incremental corridor fetch only if outside loaded corridor).

---

## 7. Difficulty model (core spec)

### 7.1 OSM scales used

Per [OSM wiki — `Key:mtb:scale`](https://wiki.openstreetmap.org/wiki/Key:mtb:scale) and
[`Key:mtb:scale:uphill`](https://wiki.openstreetmap.org/wiki/Key:mtb:scale:uphill):

| Tag                | Range   | Meaning                                                                                                                                                 |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mtb:scale`        | **0–6** | Technical difficulty **downhill/flat** (≈ S0–S6; 6 = not rideable, e.g. via ferrata). May carry `+`/`−` suffixes (`2+`) → parser rounds to nearest int. |
| `mtb:scale:uphill` | **0–5** | Difficulty riding **uphill**; 4–5 = push/carry even for strong riders.                                                                                  |
| `sac_scale`        | T1–T6   | Hiking scale (`hiking` … `difficult_alpine_hiking`); direction-independent.                                                                             |

Supporting tags: `highway`, `surface`, `tracktype`, `bicycle`/`foot`/`access` (+ `:forward`/`:backward`
variants where present), `incline`, `smoothness` (future refinement).

Node-level crux tags (`mtb:scale` on nodes) are **ignored in v1** (documented limitation).

### 7.2 User settings schema

```ts
interface Range {
  min: number;
  max: number;
}

interface RiderSettings {
  uphill: {
    mtb: Range; // mtb:scale:uphill, 0–5 (5 = accept carry)
    sac: Range; // sac_scale, T1–T6
  };
  downhill: {
    mtb: Range; // mtb:scale, 0–6
    sac: Range; // sac_scale, T1–T6
  };
  forestRoadPreference: number; // 0…1 strength, "prefer rideable terrain uphill"
  avoidUntaggedSingletrail: boolean; // safety toggle, default false
}
```

Example (all-mountain rider): uphill `mtb {0,2}`, `sac {1,3}`; downhill `mtb {0,3}`, `sac {1,4}`;
forestRoadPreference `0.6`.

Built-in presets: **Easy cruise** (up 0–1/T1–T2, down 0–1/T1–T3, forest 0.8) · **All-mountain**
(up 0–2/T1–T3, down 0–3/T1–T4, forest 0.5) · **Enduro tech** (up 0–3/T1–T4, down 1–4/T2–T5, forest 0.2)
· user-defined custom presets.

### 7.3 Band semantics: hard max, soft min

- **Upper limit (`max`) = hard exclusion.** A way whose effective difficulty in the travel direction
  exceeds `max` is **not routable in that direction** (e.g. S4 trail excluded downhill when `max = 3`).
- **Lower limit (`min`) = soft preference.** Ways _easier_ than `min` get a cost **penalty multiplier**,
  they stay routable — connectors (village streets, forest road links) must remain usable. E.g. downhill
  `min = 2` makes the router prefer S2+ singletrail over gravel roads without ever forbidding the road.
- SAC bands apply in both directions against the way's `sac_scale` (effective value, see §7.5).

### 7.4 Effective difficulty per direction

- **Downhill direction**: `mtbEff = mtb:scale` (or inferred, §7.5).
- **Uphill direction**: `mtbUpEff = mtb:scale:uphill` if tagged; else derived from `mtb:scale`,
  `surface`, `tracktype`, `sac_scale`, `incline` (§7.5).
- `sacEff = sac_scale` (or inferred from `highway`/`mtb`).

### 7.5 Untagged inference (conservative defaults)

Most forest roads carry no difficulty tags. Inference table (applied only when the tag is absent):

| Way class                                                                             | `mtb:scale` eff.                  | `mtb:scale:uphill` eff. | `sac_scale` eff. |
| ------------------------------------------------------------------------------------- | --------------------------------- | ----------------------- | ---------------- |
| `track` + `tracktype=grade1/2` + `surface` compacted/gravel/fine_gravel/paved/asphalt | 0                                 | 0                       | T1               |
| `track`, untagged                                                                     | 0–1 (use 1)                       | 1                       | T2               |
| `path`, no mtb tags                                                                   | 1                                 | 1                       | T2               |
| `path` + `surface` rock/mud/scree                                                     | 2                                 | 2                       | T3               |
| `cycleway`, paved `service`, `residential`…                                           | 0                                 | 0                       | T1               |
| `steps`                                                                               | 3 (walk)                          | 4 (portage)             | T2               |
| Cross-inference from `sac_scale`                                                      | T3→mtb ≥2 · T4→≥3 · T5→≥4 · T6→≥5 | analogous (+1 step)     | —                |

`avoidUntaggedSingletrail = true` penalizes (not excludes) untagged `highway=path` segments.

### 7.6 Cost function (shape; constants calibrated in E3.8)

Per edge _e_ and travel direction _d_ (slope _s_ = Δz/length, signed by direction):

```
baseSpeed v0  = table(highwayClass, surface, tracktype)          // km/h, flat
gradient      : uphill time = length / v0 + ascent / climbRate(difficulty, surface)
                downhill speed capped at vDownCap(difficulty)     // safety: tech = slower
diffPenalty   : if diffEff > band.max  → EXCLUDED (direction)
                if diffEff < band.min  → × penalty(min − diffEff) // soft, never excludes
forestBoost   : uphill & isForestRoad(e) → × (1 − 0.6 · forestRoadPreference)
                uphill & singletrail    → × (1 + 0.8 · forestRoadPreference · (1 − rideability))
pushCarry     : mtbUpEff ≥ 4 & allowed → walking-cost model (4 km/h, climb 400 vm/h),
                                             not bike speed
sacPenalty    : analogous soft/hard band logic vs sacEff (per direction)

cost_d(e) = seconds-equivalent;  excluded_d(e) = ∞
```

`isForestRoad(e)` ≈ `highway ∈ {track, service, unclassified}` ∧ `tracktype ∈ {grade1, grade2}`
∧ `surface ∈ {compacted, gravel, fine_gravel, paved, asphalt, concrete}`.

The cost model is a **pure module** (`src/engine/cost/`): `(wayAttrs, slopeUp, slopeDown, settings) →
{costFwd, costBwd, excludedFwd, excludedBwd}` — tested against a fixture table (≥ 30 cases).

### 7.7 Access & routability filter v2

Include `highway ∈ {track, path, cycleway, bridleway, service, unclassified, residential,
living_street, tertiary, secondary, pedestrian, footway, steps}`, then exclude entirely:

- `access ∈ {no, private}` unless `bicycle ∈ {yes, designated, permissive}`
- `highway ∈ {motorway, trunk, …links}`, `motorroad=yes`

**Walking edges (filter v2, Nockspitze feedback):** riding-prohibited ways — `bicycle ∈ {no,
private}`, plain `footway`/`pedestrian`, steps — are **not dropped**: they become walking-only
edges at portage cost (§7.6 push model), so **every trail the map displays is a snap target**.
Walking edges ignore MTB bands (no riding happens on them) but SAC safety bands still apply.
Isolated network components are kept as well (snap target ✓, route fails with a clear error if
truly disconnected). Country-specific implied-access differences are approximated globally
(documented limitation).

### 7.8 Corridor miss & widening

No path found at 2 km → automatic retry at 5 km, then 10 km, with UI status ("widening search…").
Corridor area/density cap (NFR-3): when exceeded, drop connector road classes first, then warn.

---

## 8. Overpass strategy

Two-stage query per corridor (trails first — early useful graph — connectors second):

```
[out:json][timeout:90];
(
  way["highway"~"^(track|path|cycleway|bridleway)$"](around:2000, <polyline coords>);
);
(._;>;);
out body;
```

(stage 2 adds `service|unclassified|residential|living_street|tertiary|secondary|pedestrian|footway|steps`.)

- Mirrors: `overpass-api.de`, `kumi.systems`, `overpass.private.coffee` … — ordered fallback, health-aware.
- Etiquette: identify via query comment, single corridor per planning action, throttle retries,
  cache aggressively (quantized corridor key), never poll.
- Robustness: partial results merged; hard failure → explicit error state with retry.

---

## 9. Elevation data

- **AWS Terrain Tiles, terrarium encoding** (`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`),
  public domain, no key. Zoom 12 (≈ 38 m/px) — sufficient for routing slope and profile.
- Decode in worker: `h = (R·256 + G + B/256) − 32768`; bilinear sampling per graph node.
- Tiles cached in IndexedDB (`elevationTiles` store, versioned).
- Fallback when unavailable: `incline` tag estimate; profile shows "elevation data unavailable" state.

---

## 10. Snapping

- Tap → nearest routable edge within **snap radius** (default 50 m, configurable 10–200 m):
  uniform spatial grid (≈100 m cells) over edge segments → candidate cells → point-to-segment
  projection → best hit; result may split an edge (virtual node).
- UI: snapped marker + thin rubber-band line from raw tap; if nothing within radius, waypoint stays
  unsnapped with warning (route leg may fail).
- Snapping needs corridor data: first tap in an unloaded region triggers fetch-then-snap with progress.

---

## 11. UI/UX concept

**Layout** — mobile-first:

- Fullscreen map; floating action button (FAB) toggles **plan mode** (tap = add waypoint);
  in browse mode, long-press adds. Avoids tap/drag conflicts on touch.
- **Bottom sheet**: collapsed = stats bar (distance/ascent/time); expanded = tabs _Route_ (stats,
  profile, segments), _Difficulty_ (settings), _Routes_ (saved list); full = list/edit.
- Desktop (≥ lg): same panels as a side drawer; context menu via right-click; keyboard: `Enter` add,
  `Del` remove, `Ctrl+Z/Y` undo/redo.
- Waypoints: numbered markers (start/via/end distinct), enlarged drag handles on touch, midpoint
  "insert via" handle on route legs (Komoot-like).
- Difficulty settings: dual-handle range sliders labeled S0–S6 / T1–T6 with plain-language captions
  ("rideable … push/carry"), forest-road preference as 4-step control; ≥ 44 px touch targets.
- Route rendering: cased line, per-segment color by difficulty + legend; elevation profile with
  slope/difficulty coloring, two-way map↔profile scrub sync.
- i18n EN/DE everywhere (paraglide), language persisted; dark/light follows system.

---

## 12. Persistence (IndexedDB)

| Store            | Key                                              | Value                                                                         |
| ---------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `corridors`      | `hash(quantizedPolyline, radius, schemaVersion)` | parsed graph blob + createdAt                                                 |
| `elevationTiles` | `z/x/y`                                          | decoded Float32 grid (versioned)                                              |
| `routes`         | `id` (uuid)                                      | `{name, createdAt, updatedAt, waypoints, snapped, settings, geometry, stats}` |
| `settings`       | `app`                                            | rider settings, custom presets, last viewport, locale                         |

GPX export (E6): GPX 1.1 — `<trk>` with `<name>`, `<trkpt lat/lon/ele>` densified along geometry;
`<wpt>` per waypoint; served via Blob download + Web Share API where available.

---

## 13. Risks & mitigations

| Risk                                  | Impact                   | Mitigation                                                                                                                                                        |
| ------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overpass load/reliability             | Failed/slow planning     | Corridor-limited 2-stage queries, mirror fallback, aggressive IDB cache, throttle, clear error + retry UX; future: tile backend (engine interface kept swappable) |
| Corridor misses good trails           | Poor routes              | Automatic widening 2→5→10 km with visible status; user can nudge with via-points                                                                                  |
| Browser memory on big corridors       | Crash/tab discard        | Corridor caps by area×way density, drop connector classes first, typed arrays, release graph on clear                                                             |
| Untagged difficulty = wrong inference | Bad surprises            | Conservative defaults, `avoidUntaggedSingletrail` toggle, inference table unit-tested, documented                                                                 |
| A\* too slow in JS                    | Sluggish UX              | Worker, CSR typed-array graph, binary heap, bidirectional search, cost-only recompute on settings change                                                          |
| Elevation tiles unavailable           | No profile/slope         | Tile cache, `incline` fallback, degraded-mode UI                                                                                                                  |
| mtb:scale sparse/uneven by region     | Region-dependent quality | Surface/tracktype/sac inference (§7.5); difficulty rendering shows tagged vs inferred                                                                             |

---

## 14. Attribution & licensing

- Map + routing data: **© OpenStreetMap contributors** (ODbL) — in-map attribution control + About page.
- Basemap hosting: OpenFreeMap (attribution included in style).
- Elevation: Mapzen/AWS Terrain Tiles — public domain (noted in About).
- This project's code: license decision deferred to first public release (noted in README task E7.5).

---

## 15. Milestones

| Milestone             | Contents          | Outcome                                                       |
| --------------------- | ----------------- | ------------------------------------------------------------- |
| **M1 — Routing demo** | E1, E2, E3 (core) | Two taps on a real region → difficulty-aware route on the map |
| **M2 — MVP**          | E3.8, E4, E5, E6  | Usable planner: difficulty UI, stats/profile, save/load, GPX  |
| **M3 — Solid**        | E7                | PWA/offline, perf budgets, a11y, robustness, README           |

---

## 16. Backlog (explicitly out of MVP)

Share-via-URL · round-trip generator · POI overlays (huts, springs) · trail heatmap/popularity ·
prebuilt-graph-tile or BRouter backend (engine interface is prepared) · offline region predownload ·
turn instructions · `class:bicycle:mtb` cost refinement · node-level crux difficulty · contour-line
overlay · accessibility (trailability) reporting.
