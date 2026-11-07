/**
 * Elevation profile data (E5.3): turns a RouteResult into cumulative-distance
 * samples with coordinates for the scrub↔map sync. Pure module.
 */
import { segmentColor } from '../map/difficultyColors';
import type { RouteResult } from '../../engine/protocol';

export interface ProfileSample {
  /** cumulative distance from route start, meters */
  dM: number;
  ele: number | null;
  lat: number;
  lng: number;
  /** color of the interval ENDING at this sample (null for the first) */
  color: string | null;
  /** interval difficulty level (for the popup/tooltip), null for the first */
  difficulty: number | null;
  walking: boolean;
}

export interface ProfileData {
  samples: ProfileSample[];
  totalM: number;
  /** false when the route has no elevations (degraded mode) */
  available: boolean;
  minEle: number;
  maxEle: number;
}

/** Index of the last sample with dM <= d (linear scan — sample counts are small). */
function sampleIndexFor(samples: ProfileSample[], dM: number): number {
  let idx = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i]!.dM <= dM) idx = i;
    else break;
  }
  return idx;
}

/** Interpolated position at distance `dM` (null outside the route). */
export function profileAt(data: ProfileData, dM: number): ProfileSample | null {
  const { samples } = data;
  if (samples.length === 0 || dM < 0 || dM > data.totalM + 1e-6) return null;
  const idx = sampleIndexFor(samples, dM);
  const a = samples[idx]!;
  const b = samples[Math.min(idx + 1, samples.length - 1)]!;
  const span = b.dM - a.dM;
  const t = span > 0 ? Math.max(0, Math.min(1, (dM - a.dM) / span)) : 0;
  const ele =
    a.ele !== null && b.ele !== null ? a.ele + (b.ele - a.ele) * t : (a.ele ?? b.ele ?? null);
  return {
    dM,
    ele,
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    color: t >= 0.5 ? b.color : a.color,
    difficulty: t >= 0.5 ? b.difficulty : a.difficulty,
    walking: t >= 0.5 ? b.walking : a.walking,
  };
}

export function buildProfileData(route: RouteResult): ProfileData {
  const samples: ProfileSample[] = [];
  let dM = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  let available = route.elevationAvailable;

  for (const leg of route.legs) {
    for (const seg of leg.segments) {
      const color = segmentColor(seg);
      const [from, to] = seg.coords;
      const vertices: [number, number, number | null][] = [from!, to!];
      for (let i = 0; i < vertices.length; i++) {
        const [lat, lng, ele] = vertices[i]!;
        const isLast = i === vertices.length - 1;
        const sampleD = isLast ? dM + seg.distanceM : dM;
        const prev = samples[samples.length - 1];
        // dedupe joint vertices repeated between consecutive segments
        if (prev && Math.abs(prev.dM - sampleD) < 0.01 && Math.abs(prev.lng - lng) < 1e-9) {
          continue;
        }
        samples.push({
          dM: sampleD,
          ele,
          lat,
          lng,
          color: i === 0 && prev ? prev.color : color,
          difficulty: i === 0 && prev ? prev.difficulty : Math.round(seg.difficulty ?? seg.mtbDown),
          walking: seg.walking === true,
        });
        if (ele !== null) {
          minEle = Math.min(minEle, ele);
          maxEle = Math.max(maxEle, ele);
        } else {
          available = false;
        }
      }
      dM += seg.distanceM;
    }
  }

  return {
    samples,
    totalM: dM,
    available: available && samples.length >= 2,
    minEle: Number.isFinite(minEle) ? minEle : 0,
    maxEle: Number.isFinite(maxEle) ? maxEle : 1,
  };
}
