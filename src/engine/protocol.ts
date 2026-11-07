/**
 * Rider settings shared between main thread, worker and the pure cost model
 * (PLAN §7.2). SAC levels are numeric T1..T6, MTB 0..6 (uphill scale 0..5).
 */
export interface Range {
  min: number;
  max: number;
}

export interface DifficultyBands {
  /** mtb:scale (downhill, 0–6) or mtb:scale:uphill (0–5) band */
  mtb: Range;
  /** sac_scale band T1..T6 */
  sac: Range;
}

export interface RiderSettings {
  uphill: DifficultyBands;
  downhill: DifficultyBands;
  /** 0..1 — prefer rideable terrain (forest roads) uphill (FR-6) */
  forestRoadPreference: number;
  /** penalize (not exclude) untagged singletrail (PLAN §7.5) */
  avoidUntaggedSingletrail: boolean;
}

export const DEFAULT_SETTINGS: RiderSettings = {
  uphill: { mtb: { min: 0, max: 2 }, sac: { min: 1, max: 3 } },
  downhill: { mtb: { min: 0, max: 3 }, sac: { min: 1, max: 4 } },
  forestRoadPreference: 0.5,
  avoidUntaggedSingletrail: false,
};

import type { SnapResult } from '../lib/osm/snapIndex';

/** corridor stage: 0 tiles, 1 trails, 2 roads, 3 OSM-API fallback, 4 elevation */
export type EngineStage = 0 | 1 | 2 | 3 | 4;

export type HostToWorker =
  | {
      id: number;
      type: 'plan';
      points: [number, number][];
      settings: RiderSettings;
      tileBaseUrl: string | null;
      snapRadiusM: number;
    }
  | { id: number; type: 'reroute'; settings: RiderSettings }
  | { id: number; type: 'setSnapRadius'; snapRadiusM: number }
  | { id: number; type: 'snapProbe'; lng: number; lat: number }
  | { type: 'cancel' };

export type WorkerErrorCode = 'corridor' | 'no_route' | 'waypoint' | 'region_not_built';

export type WorkerToHost =
  | { id: number; type: 'progress'; stage: EngineStage }
  | { id: number; type: 'ready'; snaps: (SnapResult | null)[]; radiusM: number }
  | { id: number; type: 'route'; route: RouteResult }
  | { id: number; type: 'widening' }
  | { id: number; type: 'error'; code: WorkerErrorCode }
  | { type: 'snapProbeResult'; lng: number; lat: number; snap: SnapResult | null };

/** Route request/result payload types shared over the worker protocol. */
export interface RouteSegment {
  wayId: number;
  highway: string;
  surface?: string;
  /** effective difficulties of this way (PLAN §7.4/7.5) */
  mtbDown: number;
  mtbUp: number;
  sac: number;
  /** true when an explicit mtb tag was present (vs inferred) */
  difficultyTagged: boolean;
  /** [lat, lng, ele|null] per vertex */
  coords: [number, number, number | null][];
  distanceM: number;
  ascentM: number;
  descentM: number;
  timeS: number;
  /** effective MTB difficulty in travel direction, rounded 0..6 (E5 coloring) */
  difficulty?: number;
  /** walking-only edge (footway / bicycle=no → portage) */
  walking?: boolean;
  /** |Δz| / length of the underlying way segment (E5.2 max slope) */
  slope?: number;
}

export interface RouteLeg {
  segments: RouteSegment[];
  distanceM: number;
  ascentM: number;
  descentM: number;
  timeS: number;
}

export interface RouteResult {
  legs: RouteLeg[];
  total: {
    distanceM: number;
    ascentM: number;
    descentM: number;
    timeS: number;
    /** steepest |Δz|/len over all way segments (E5.2) */
    maxSlope?: number;
  };
  /** km per effective MTB difficulty in travel direction, index 0..6 */
  kmByMtb: number[];
  /** km on walking-only (portage) edges, excluded from kmByMtb (E5.2) */
  kmWalking?: number;
  /** corridor radius that produced this route (widening result) */
  radiusM: number;
  elevationAvailable: boolean;
}
