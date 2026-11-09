/**
 * Planning orchestration state (E2/E3): plan/browse mode, snap radius,
 * corridor + routing status. The heavy lifting happens in the engine worker;
 * this store mirrors its progress and feeds the UI.
 */
import { resolveTileBaseUrl } from '../osm/staticTiles';
import type { SnapResult } from '../osm/snapIndex';
import { waypoints } from '../waypoints/store.svelte';
import { getEngineHost } from '../../engine/host';
import { type RouteResult, type RiderSettings } from '../../engine/protocol';
import { loadRiderSettings, saveRiderSettings } from './settingsPersist';

export type CorridorPhase = 'idle' | 'loading' | 'ready' | 'error';
export type PlanningMode = 'browse' | 'plan';

const SNAP_RADIUS_KEY = 'mtbr.snapRadius.v1';
const CONTOURS_KEY = 'mtbr.contours.v1';
export const SNAP_RADIUS_CHOICES = [50, 100, 250, 500] as const;
const DEFAULT_SNAP_RADIUS_M = 250;

function loadContours(): boolean {
  try {
    return localStorage.getItem(CONTOURS_KEY) !== '0';
  } catch {
    return true;
  }
}

function loadSnapRadius(): number {
  try {
    const raw = localStorage.getItem(SNAP_RADIUS_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 && value <= 500 ? value : DEFAULT_SNAP_RADIUS_M;
  } catch {
    return DEFAULT_SNAP_RADIUS_M;
  }
}

class PlanningState {
  mode = $state<PlanningMode>('browse');

  /**
   * Mobile bottom sheet expanded? (Desktop drawer is always open — the
   * Fab hides itself on phones while the sheet covers the map corner.)
   */
  sheetExpanded = $state(false);

  phase = $state<CorridorPhase>('idle');
  /** 0 tiles, 1 trails, 2 roads, 3 OSM-API fallback, 4 elevation */
  stage = $state<0 | 1 | 2 | 3 | 4>(0);
  widening = $state(false);
  /** bumped whenever the worker reports a fresh snap index */
  indexVersion = $state(0);
  /** last routing result (null until E3 produces one) */
  route = $state<RouteResult | null>(null);
  /** worker error code for the status pill */
  errorCode = $state<import('../../engine/protocol').WorkerErrorCode | null>(null);

  snapRadiusM = $state<number>(loadSnapRadius());
  /** contour lines overlay (Settings toggle, default on) */
  contours = $state<boolean>(loadContours());
  /** rider difficulty settings (E4) — edited in the Difficulty tab, persisted (E6.3) */
  settings = $state<RiderSettings>(loadRiderSettings());

  private host = getEngineHost({
    onProgress: (stage) => {
      this.phase = 'loading';
      this.stage = stage;
      this.widening = false;
    },
    onReady: (snaps) => {
      waypoints.applySnaps(snaps);
      this.phase = 'ready';
      this.widening = false;
      this.indexVersion++;
    },
    onRoute: (route) => {
      this.route = route;
      this.phase = 'ready';
    },
    onWidening: () => {
      this.widening = true;
      this.phase = 'loading';
    },
    onError: (code) => {
      this.phase = 'error';
      this.errorCode = code;
    },
  });

  private lastPoints: [number, number][] = [];
  private lastPlannedSig = '';
  private lastRetry = 0;
  private rerouteTimer: ReturnType<typeof setTimeout> | undefined;

  setMode(mode: PlanningMode): void {
    this.mode = mode;
  }

  toggleMode(): void {
    this.mode = this.mode === 'plan' ? 'browse' : 'plan';
  }

  /** Difficulty change (E4.3): debounced recompute + reroute, no refetch. */
  setSettings(next: RiderSettings): void {
    // $state.snapshot strips Svelte proxies — proxies cannot be structured-
    // cloned across postMessage (would kill every worker plan silently)
    this.settings = $state.snapshot(next);
    saveRiderSettings(this.settings);
    clearTimeout(this.rerouteTimer);
    this.rerouteTimer = setTimeout(() => {
      if (this.lastPoints.length >= 2) this.host.reroute($state.snapshot(this.settings));
    }, 300);
  }

  /** Restore saved settings without triggering a reroute (E6.3). */
  restoreSettings(saved: RiderSettings): void {
    clearTimeout(this.rerouteTimer);
    this.settings = $state.snapshot(saved);
    saveRiderSettings(this.settings);
  }

  setSnapRadius(radiusM: number): void {
    this.snapRadiusM = radiusM;
    try {
      localStorage.setItem(SNAP_RADIUS_KEY, String(radiusM));
    } catch {
      // private mode — choice won't persist
    }
    if (this.lastPoints.length > 0) this.host.setSnapRadius(radiusM);
  }

  setContours(on: boolean): void {
    this.contours = on;
    try {
      localStorage.setItem(CONTOURS_KEY, on ? '1' : '0');
    } catch {
      // private mode — choice won't persist
    }
  }

  retry(): void {
    this.errorCode = null;
    this.lastPlannedSig = ''; // force a replan
    if (this.lastPoints.length > 0) this.ensureCorridor(this.lastPoints);
  }

  /** async drag probe (fire-and-forget; resolves with the snap or null) */
  snapProbe(lng: number, lat: number): Promise<SnapResult | null> {
    return this.host.snapProbe(lng, lat);
  }

  /** called from an App effect whenever the raw waypoint polyline changes */
  async ensureCorridor(points: [number, number][]): Promise<void> {
    this.lastPoints = points;
    if (points.length === 0) {
      this.lastPlannedSig = '';
      this.phase = 'idle';
      this.route = null;
      this.errorCode = null;
      this.host.cancel();
      return;
    }
    if (points.length === 1) {
      // a single waypoint cannot produce a route — drop the previous one
      // (user bug: deleting a waypoint left its beeline leg on the map)
      this.route = null;
    }
    // snap updates reassign the waypoints array (identity) without moving it —
    // replanning the identical polyline would abort the in-flight corridor
    // fetch, which is never cached, and re-download everything (request spam)
    const sig =
      points.map((p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`).join(';') +
      '|r' +
      this.snapRadiusM;
    // pure signature check — a fail-open on 'error' caused an infinite
    // replan loop (error → effect re-run → replan → error …)
    if (sig === this.lastPlannedSig) return;
    this.lastPlannedSig = sig;
    this.phase = 'loading';
    this.errorCode = null;
    // resolves the tile base: explicit setting, else auto-discovery on the
    // same domain (probed once per session)
    const tileBase = await resolveTileBaseUrl();
    this.host.plan(points, $state.snapshot(this.settings), tileBase, this.snapRadiusM);
  }
}

export const planning = new PlanningState();
