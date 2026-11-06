/**
 * GPX 1.1 export (E6.2): pure builder from a RouteResult + waypoint labels.
 * One <trkseg> per leg (segments may share the via-waypoint endpoint — valid
 * GPX), <wpt> per waypoint, <ele> omitted when elevation is unavailable.
 */
import type { RouteResult } from '../../engine/protocol';

export interface GpxWaypoint {
  lat: number;
  lon: number;
  name: string;
}

export interface GpxInput {
  name: string;
  route: RouteResult | null;
  waypoints: GpxWaypoint[];
  /** ISO timestamp for <metadata><time>; defaults to now */
  time?: string;
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const fmt = (v: number): string => v.toFixed(7).replace(/\.?0+$/, '') || '0';
const fmtEle = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

export function buildGpx(input: GpxInput): string {
  const time = esc(input.time ?? new Date().toISOString());
  const name = esc(input.name);

  const wpts = input.waypoints
    .map(
      (wp) =>
        `  <wpt lat="${fmt(wp.lat)}" lon="${fmt(wp.lon)}">\n    <name>${esc(wp.name)}</name>\n  </wpt>`,
    )
    .join('\n');

  let trk = '';
  if (input.route) {
    const segs = input.route.legs
      .filter((leg) => leg.segments.length > 0)
      .map((leg) => {
        const pts: string[] = [];
        let last = '';
        for (const seg of leg.segments) {
          for (const [lat, lon, ele] of seg.coords) {
            // skip joint points repeated between consecutive segments
            const coords = `lat="${fmt(lat)}" lon="${fmt(lon)}"`;
            if (coords === last) continue;
            last = coords;
            const eleTag =
              ele === null || ele === undefined ? '' : `\n      <ele>${fmtEle(ele)}</ele>`;
            pts.push(`    <trkpt ${coords}>${eleTag}\n    </trkpt>`);
          }
        }
        return `   <trkseg>\n${pts.join('\n')}\n   </trkseg>`;
      })
      .join('\n');
    trk = ` <trk>\n  <name>${name}</name>\n${segs}\n </trk>`;
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="MTB Router" xmlns="http://www.topografix.com/GPX/1/1">',
    ` <metadata>\n  <name>${name}</name>\n  <time>${time}</time>\n </metadata>`,
    wpts,
    trk,
    '</gpx>',
    '',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/** Suggested download filename for a route name. */
export function gpxFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[\p{M}]+/gu, '') // strip combining marks (Ä → A)
    .replaceAll(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug === '' ? 'route' : slug.slice(0, 60)}.gpx`;
}
