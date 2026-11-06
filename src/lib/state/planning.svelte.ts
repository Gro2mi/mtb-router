/**
 * Planning orchestration state (E2/E3): plan/browse mode, snap radius,
 * corridor + routing status. The heavy lifting happens in the engine worker;
 * this store mirrors its progress and feeds the UI.
 */
import { getTileBaseUrl } from '../osm/staticTiles';
import type { SnapResult } from '../osm/snapIndex';
import { waypoints } from '../waypoints/store.svelte';
import { getEngineHost } from '../../engine/host';
import { DEFAULT_SETTINGS, type RouteResult, type RiderSettings } from '../../engine/protocol';

export type CorridorPhase = 'idle' | 'loading' | 'ready' | 'error';
export type PlanningMode = 'browse' | 'plan';

const SNAP_RADIUS_KEY = 'mtbr.snapRadius.v1';
export const SNAP_RADIUS_CHOICES = [10, 30, 50, 100, 200] as const;
const DEFAULT_SNAP_RADIUS_M = 50;

/** rider settings — UI editing arrives with E4; defaults for now */
export function riderSettings(): RiderSettings {
  return DEFAULT_SETTINGS;
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

  phase = $state<CorridorPhase>('idle');
  /** 0 tiles, 1 trails, 2 roads, 3 OSM-API fallback, 4 elevation */
  stage = $state<0 | 1 | 2 | 3 | 4>(0);
  widening = $state(false);
  /** bumped whenever the worker reports a fresh snap index */
  indexVersion = $state(0);
  /** last routing result (null until E3 produces one) */
  route = $state<RouteResult | null>(null);
  /** worker error code for the status pill */
  errorCode = $state<'corridor' | 'no_route' | 'waypoint' | null>(null);

  snapRadiusM = $state<number>(loadSnapRadius());

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
  private lastRetry = 0;

  setMode(mode: PlanningMode): void {
    this.mode = mode;
  }

  toggleMode(): void {
    this.mode = this.mode === 'plan' ? 'browse' : 'plan';
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

  retry(): void {
    this.errorCode = null;
    if (this.lastPoints.length > 0) this.ensureCorridor(this.lastPoints);
  }

  /** async drag probe (fire-and-forget; resolves with the snap or null) */
  snapProbe(lng: number, lat: number): Promise<SnapResult | null> {
    return this.host.snapProbe(lng, lat);
  }

  /** called from an App effect whenever the raw waypoint polyline changes */
  ensureCorridor(points: [number, number][]): void {
    this.lastPoints = points;
    if (points.length === 0) {
      this.phase = 'idle';
      this.route = null;
      this.errorCode = null;
      this.host.cancel();
      return;
    }
    this.phase = 'loading';
    this.errorCode = null;
    this.host.plan(points, riderSettings(), getTileBaseUrl(), this.snapRadiusM);
  }
}

export const planning = new PlanningState();
