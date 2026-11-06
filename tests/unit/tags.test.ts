import { describe, expect, it } from 'vitest';
import { isRoutable, parseScaleValue, parseWayTags } from '../../src/lib/osm/tags';

function attrs(tags: Record<string, string>): ReturnType<typeof parseWayTags> {
  return parseWayTags(tags);
}

describe('parseScaleValue', () => {
  it.each([
    ['2', 2],
    ['0', 0],
    ['6', 6],
    ['2+', 2.5],
    ['2-', 1.5],
    ['garbage', undefined],
    [undefined, undefined],
    ['', undefined],
  ])('parses %s -> %s', (input, expected) => {
    expect(parseScaleValue(input)).toBe(expected);
  });
});

describe('isRoutable (PLAN §7.7)', () => {
  it('accepts the include-list highway classes', () => {
    // pedestrian/footway are NOT here: they are only routable conditionally
    // (see the footway test below)
    for (const highway of [
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
      'steps',
    ]) {
      expect(isRoutable(attrs({ highway }))).toBe(true);
    }
  });

  it('excludes motorized-only classes', () => {
    expect(isRoutable(attrs({ highway: 'motorway' }))).toBe(false);
    expect(isRoutable(attrs({ highway: 'trunk' }))).toBe(false);
    expect(isRoutable(attrs({ highway: 'motorway_link' }))).toBe(false);
    expect(isRoutable(attrs({ highway: '' }))).toBe(false);
  });

  it('excludes motorroad=yes', () => {
    expect(isRoutable(attrs({ highway: 'tertiary', motorroad: 'yes' }))).toBe(false);
  });

  it('excludes bicycle=no/private', () => {
    expect(isRoutable(attrs({ highway: 'track', bicycle: 'no' }))).toBe(false);
    expect(isRoutable(attrs({ highway: 'path', bicycle: 'private' }))).toBe(false);
  });

  it('keeps bicycle=destination', () => {
    expect(
      isRoutable(attrs({ highway: 'service', service: 'driveway', bicycle: 'destination' })),
    ).toBe(true);
  });

  it('excludes access=private unless explicitly bike-permitted', () => {
    expect(isRoutable(attrs({ highway: 'track', access: 'private' }))).toBe(false);
    expect(isRoutable(attrs({ highway: 'track', access: 'private', bicycle: 'yes' }))).toBe(true);
    expect(isRoutable(attrs({ highway: 'track', access: 'private', bicycle: 'designated' }))).toBe(
      true,
    );
  });

  it('excludes plain footways but keeps bike-permitted or segregated ones', () => {
    expect(isRoutable(attrs({ highway: 'footway' }))).toBe(false);
    expect(isRoutable(attrs({ highway: 'pedestrian' }))).toBe(false);
    expect(isRoutable(attrs({ highway: 'footway', bicycle: 'yes' }))).toBe(true);
    expect(isRoutable(attrs({ highway: 'footway', bicycle: 'designated' }))).toBe(true);
    expect(isRoutable(attrs({ highway: 'footway', segregated: 'yes' }))).toBe(true);
  });

  it('keeps steps as portage candidates', () => {
    const steps = attrs({ highway: 'steps' });
    expect(isRoutable(steps)).toBe(true);
    expect(steps.isSteps).toBe(true);
  });

  it('parses difficulty tags for later cost modeling', () => {
    const a = attrs({
      highway: 'path',
      'mtb:scale': '2+',
      'mtb:scale:uphill': '3',
      sac_scale: 'demanding_mountain_hiking',
      surface: 'gravel',
      tracktype: 'grade2',
      incline: 'up',
    });
    expect(a.mtbScale).toBe(2.5);
    expect(a.mtbScaleUphill).toBe(3);
    expect(a.sacScale).toBe('demanding_mountain_hiking');
    expect(a.surface).toBe('gravel');
    expect(a.tracktype).toBe('grade2');
    expect(a.incline).toBe('up');
  });
});
