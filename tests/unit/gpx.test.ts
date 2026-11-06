import { describe, expect, it } from 'vitest';
import { buildGpx, gpxFileName, type GpxInput } from '../../src/lib/gpx/gpx';
import type { RouteResult } from '../../src/engine/protocol';

const route: RouteResult = {
  legs: [
    {
      segments: [
        {
          wayId: 1,
          highway: 'track',
          mtbDown: 0,
          mtbUp: 0,
          sac: 1,
          difficultyTagged: false,
          coords: [
            [47.0, 8.0, 500],
            [47.0005, 8.0005, 510.25],
          ],
          distanceM: 70,
          ascentM: 10,
          descentM: 0,
          timeS: 30,
        },
        {
          wayId: 2,
          highway: 'path',
          mtbDown: 1,
          mtbUp: 1,
          sac: 2,
          difficultyTagged: true,
          coords: [
            [47.0005, 8.0005, 510.25],
            [47.001, 8.001, 505], // descent
          ],
          distanceM: 70,
          ascentM: 0,
          descentM: 5,
          timeS: 40,
        },
      ],
      distanceM: 140,
      ascentM: 10,
      descentM: 5,
      timeS: 70,
    },
    {
      segments: [
        {
          wayId: 3,
          highway: 'track',
          mtbDown: 0,
          mtbUp: 0,
          sac: 1,
          difficultyTagged: false,
          coords: [
            [47.001, 8.001, 505],
            [47.002, 8.002, null],
          ],
          distanceM: 150,
          ascentM: 0,
          descentM: 0,
          timeS: 50,
        },
      ],
      distanceM: 150,
      ascentM: 0,
      descentM: 0,
      timeS: 50,
    },
  ],
  total: { distanceM: 290, ascentM: 10, descentM: 5, timeS: 120 },
  kmByMtb: [0.29, 0, 0, 0, 0, 0, 0],
  radiusM: 2000,
  elevationAvailable: true,
};

const input: GpxInput = {
  name: 'Nockspitze Runde & "Test"',
  route,
  waypoints: [
    { lat: 47.0, lon: 8.0, name: 'Waypoint 1' },
    { lat: 47.001, lon: 8.001, name: 'Waypoint 2' },
    { lat: 47.002, lon: 8.002, name: 'Waypoint 3' },
  ],
  time: '2026-11-06T10:00:00.000Z',
};

describe('GPX builder (E6.2)', () => {
  const gpx = buildGpx(input);

  it('emits a GPX 1.1 skeleton with metadata', () => {
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain(
      '<gpx version="1.1" creator="MTB Router" xmlns="http://www.topografix.com/GPX/1/1">',
    );
    expect(gpx).toContain('<name>Nockspitze Runde &amp; &quot;Test&quot;</name>');
    expect(gpx).toContain('<time>2026-11-06T10:00:00.000Z</time>');
    expect(gpx.trimEnd().endsWith('</gpx>')).toBe(true);
  });

  it('is XML-attribute escaped in names', () => {
    expect(gpx).not.toContain('Nockspitze Runde & "Test"'); // raw form must be gone
  });

  it('emits one wpt per waypoint with names', () => {
    expect(gpx.match(/<wpt /g)).toHaveLength(3);
    expect(gpx).toContain('<wpt lat="47" lon="8">');
    expect(gpx).toContain('<name>Waypoint 2</name>');
  });

  it('emits one trkseg per leg with ele tags', () => {
    expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
    expect(gpx.match(/<trkpt /g)).toHaveLength(5); // 3 (deduped joint) + 2 points
    expect(gpx).toContain('<ele>510.3</ele>'); // rounded to 1 decimal
    expect(gpx).toContain('<ele>505.0</ele>');
  });

  it('omits ele when elevation is unavailable (degraded mode)', () => {
    const degraded = buildGpx({
      ...input,
      route: {
        ...route,
        legs: route.legs.map((leg) => ({
          ...leg,
          segments: leg.segments.map((s) => ({
            ...s,
            coords: s.coords.map(([lat, lon]) => [lat, lon, null]),
          })),
        })),
      },
    });
    expect(degraded).not.toContain('<ele>');
    expect(degraded.match(/<trkpt /g)).toHaveLength(5);
  });

  it('emits wpts only when no route exists', () => {
    const bare = buildGpx({ ...input, route: null });
    expect(bare).toContain('<wpt lat="47"');
    expect(bare).not.toContain('<trk>');
  });

  it('formats coordinates compactly but precisely', () => {
    // 7 decimals max, trailing zeros trimmed
    expect(gpx).toContain('lat="47.0005"');
    expect(gpx).not.toContain('47.0005000');
  });

  it('builds a filesystem-safe filename', () => {
    expect(gpxFileName('Nockspitze Runde!')).toBe('nockspitze-runde.gpx');
    expect(gpxFileName('   ')).toBe('route.gpx');
    expect(gpxFileName('Änderung Über')).toBe('anderung-uber.gpx');
  });

  it('golden: full document structure snapshot', () => {
    const lines = gpx.split('\n');
    // first three and last line as a structural golden check
    expect(lines[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(lines[1]).toBe(
      '<gpx version="1.1" creator="MTB Router" xmlns="http://www.topografix.com/GPX/1/1">',
    );
    expect(lines[2]?.trim()).toBe('<metadata>');
    expect(lines.at(-1)).toBe('</gpx>');
  });
});
