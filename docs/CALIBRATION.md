# Calibrating ride-time estimates (E3.8)

The planner's **Duration** is estimated from a physics-ish cost model
(`src/engine/cost/model.ts`). Its constants encode assumptions about _your_ riding that
should be tuned against real rides: pick 3–5 rides with a known **moving time** from your
watch, plan the same start/end here, and compare.

## Procedure

1. Pick known rides — ideally one per profile: flat forest-road spin, a steady climb ride,
   a technical descent ride.
2. Plan each ride in the app (same start/end) and note the **Duration** plus the
   **difficulty split** (Route tab).
3. Compare against the watch's moving time. Systematic offsets point at specific constants:
   - **Everything ~10 % too slow** → scale `FLAT_SPEED_KMH` up by ~10 % (or reduce
     `DIFFICULTY_DRAG` if the gap grows with difficulty).
   - **Climbs too slow, flats fine** → raise `CLIMB_RATE_VMH` (and `CLIMB_RATE_MIN`).
   - **Descents too fast / too slow** → adjust `DESC_CAP_KMH` (the cap per difficulty) and
     `DESC_BOOST_FACTOR`.
   - **Push/carry sections off** → `PUSH_SPEED_MS` (walking pace) and `PUSH_CLIMB_VMH`.
4. Edit the constants in `COST` (single object at the top of `model.ts`), then update the
   expected numbers in `tests/unit/calibration.test.ts` and run `npm test`.
5. The calibration tests are **regression fixtures**: they pin the current behavior for
   representative synthetic routes so tuning never silently changes estimates.

## The constants and their real-world meaning

| Constant           | Meaning                                           | Typical real-world anchor                                      |
| ------------------ | ------------------------------------------------- | -------------------------------------------------------------- |
| `FLAT_SPEED_KMH`   | base speed per highway class on flat ground       | forest road 12–18 km/h, singletrail 8–14 km/h, road 18–25 km/h |
| `SURFACE_FACTOR`   | speed multiplier per surface                      | asphalt 1.1–1.2, gravel 0.9, sand/mud 0.5–0.6                  |
| `DIFFICULTY_DRAG`  | speed loss per MTB difficulty step (~9 %)         | S2 ≈ 10–25 % slower than S0 on same terrain                    |
| `CLIMB_RATE_VMH`   | vertical climb rate at S0                         | fit MTB riders: 500–800 vm/h; loaded/touring: 300–500          |
| `DESC_CAP_KMH`     | downhill speed cap per difficulty                 | safety-oriented; strong riders exceed 30 km/h on open descents |
| `PUSH_SPEED_MS`    | walking speed when pushing                        | ~4.5 km/h (1.25 m/s)                                           |
| `PUSH_CLIMB_VMH`   | vertical rate when carrying                       | 250–400 vm/h                                                   |
| `SOFT_MIN_PENALTY` | cost bump per step below the preferred difficulty | 20–50 % per step                                               |
| `FOREST_REWARD`    | uphill discount for rideable forest roads         | how much you _prefer_ fire roads over singletrail              |

Direction-awareness reminder: climbing segments use the **uphill** scale
(`mtb:scale:uphill`) and descending segments the **downhill** scale (`mtb:scale`) — tune
climb constants against climbs only, and descent caps against descents only.

## Where the current numbers came from

Initial values (2026-11-06) are literature-based estimates for a fit all-mountain rider:
forest road 13 km/h flat, ~420 vm/h climbing at S0 decaying ~45 vm/h per difficulty step,
downhill capped at 34 km/h (S0) down to 8 km/h (S6). They have **not** yet been validated
against recorded rides — that is exactly what this calibration procedure is for.
