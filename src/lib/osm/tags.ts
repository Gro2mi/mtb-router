/**
 * OSM way-tag parsing + bicycle routability filter v1 (E2.4, PLAN §7.7).
 * Pure module — the graph builder (E3) reuses the same WayAttrs.
 */

/** Highway classes that can carry bike-legal ways (PLAN §7.7 include list). */
export const ALLOWED_HIGHWAYS: ReadonlySet<string> = new Set([
  'track',
  'path',
  'cycleway',
  'bridleway',
  'service',
  'unclassified',
  'residential',
  'living_street',
  'tertiary',
  'secondary',
  'pedestrian',
  // bike-legal only with bicycle=yes/designated/permissive or segregated (see below)
  'footway',
  // kept as portage edges; the cost model (E3.3) gates them via difficulty bands
  'steps',
]);

const BLOCKING = new Set(['no', 'private']);
const BIKE_PERMITTED = new Set(['yes', 'designated', 'permissive', 'destination']);

export interface WayAttrs {
  highway: string;
  surface?: string;
  tracktype?: string;
  /** mtb:scale 0–6; `2+` parses to 2.5 */
  mtbScale?: number;
  /** mtb:scale:uphill 0–5 */
  mtbScaleUphill?: number;
  /** sac_scale, e.g. "hiking" (T1) … "difficult_alpine_hiking" (T6) */
  sacScale?: string;
  bicycle?: string;
  /** directional variants; narrow a way for E3 routing but do not drop it here */
  bicycleForward?: string;
  bicycleBackward?: string;
  foot?: string;
  access?: string;
  motorroad?: string;
  segregated?: string;
  incline?: string;
  /** 'yes' | '-1' | undefined (E3: directional edge generation) */
  oneway?: string;
  /** oneway:bicycle — 'no' exempts bikes from a road oneway */
  onewayBicycle?: string;
  isSteps: boolean;
  /** riding prohibited here — the way stays routable at walking (portage) cost */
  walkingOnly: boolean;
}

/** Parse a scale value like "2", "2+" or "2-" into 2 / 2.5 / 1.5. */
export function parseScaleValue(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const base = parseFloat(trimmed);
  if (!Number.isFinite(base)) return undefined;
  if (trimmed.endsWith('+')) return Math.min(base + 0.5, 6.5);
  if (trimmed.endsWith('-')) return Math.max(base - 0.5, 0);
  return Math.max(0, Math.min(6.5, base));
}

export function parseWayTags(tags: Record<string, string> = {}): WayAttrs {
  const attrs: WayAttrs = {
    highway: tags['highway'] ?? '',
    surface: tags['surface'],
    tracktype: tags['tracktype'],
    mtbScale: parseScaleValue(tags['mtb:scale']),
    mtbScaleUphill: parseScaleValue(tags['mtb:scale:uphill']),
    sacScale: tags['sac_scale'],
    bicycle: tags['bicycle'],
    bicycleForward: tags['bicycle:forward'],
    bicycleBackward: tags['bicycle:backward'],
    foot: tags['foot'],
    access: tags['access'],
    motorroad: tags['motorroad'],
    segregated: tags['segregated'],
    incline: tags['incline'],
    oneway: tags['oneway'],
    onewayBicycle: tags['oneway:bicycle'],
    isSteps: tags['highway'] === 'steps',
    walkingOnly: false,
  };
  attrs.walkingOnly = isWalkingOnly(attrs);
  return attrs;
}

/**
 * Riding prohibited / pointless on this way? Walking ways remain in the data
 * and stay snap/routable at walking (portage) cost — displayed trails must be
 * snappable (Nockspitze feedback), the cost model prices them as walking.
 */
export function isWalkingOnly(attrs: WayAttrs): boolean {
  if (attrs.isSteps) return true;
  if (attrs.bicycle !== undefined && BLOCKING.has(attrs.bicycle)) return true;
  const footPath =
    attrs.highway === 'footway' || attrs.highway === 'pedestrian' || attrs.highway === 'steps';
  return footPath && !(attrs.bicycle !== undefined && BIKE_PERMITTED.has(attrs.bicycle));
}

/**
 * Way-level bicycle routability per PLAN §7.7 (filter v2). Riding-prohibited
 * ways (footways, bicycle=no) are NOT dropped — they become walking-only
 * edges so every displayed trail is a snap target; the cost model prices
 * them as walking (portage). Dropped entirely: motorized-only classes,
 * motorroad, and access-blocked ways without explicit bike permission.
 */
export function isRoutable(attrs: WayAttrs): boolean {
  if (!ALLOWED_HIGHWAYS.has(attrs.highway)) return false; // also excludes motorway/trunk(+links)
  if (attrs.motorroad === 'yes') return false;
  if (
    attrs.access !== undefined &&
    BLOCKING.has(attrs.access) &&
    !(attrs.bicycle !== undefined && BIKE_PERMITTED.has(attrs.bicycle))
  ) {
    return false;
  }
  return true;
}
