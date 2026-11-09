import { describe, expect, it } from 'vitest';
import { trailLabelFromTags } from '../../src/lib/map/trailTileLabels';

/**
 * Label rule for the corridor-tile trail labels (user request: all trails,
 * S preferred over T, uncluttered — T1 hiking default is skipped).
 */
describe('trailLabelFromTags (corridor-tile trail labels)', () => {
  it('mtb:scale wins (S over T) with suffix notation kept readable', () => {
    expect(trailLabelFromTags({ 'mtb:scale': '2' })).toBe('S2');
    expect(trailLabelFromTags({ 'mtb:scale': '2+' })).toBe('S2+');
    expect(trailLabelFromTags({ 'mtb:scale': '2', sac_scale: 'alpine_hiking' })).toBe('S2');
  });

  it('mtb:scale:uphill-only way gets an S label', () => {
    expect(trailLabelFromTags({ 'mtb:scale:uphill': '3' })).toBe('S3');
  });

  it('sac_scale maps to T2..T6', () => {
    expect(trailLabelFromTags({ sac_scale: 'mountain_hiking' })).toBe('T2');
    expect(trailLabelFromTags({ sac_scale: 'demanding_mountain_hiking' })).toBe('T3');
    expect(trailLabelFromTags({ sac_scale: 'alpine_hiking' })).toBe('T4');
    expect(trailLabelFromTags({ sac_scale: 'demanding_alpine_hiking' })).toBe('T5');
    expect(trailLabelFromTags({ sac_scale: 'difficult_alpine_hiking' })).toBe('T6');
  });

  it('plain hiking (T1) is skipped to avoid clutter', () => {
    expect(trailLabelFromTags({ sac_scale: 'hiking' })).toBeNull();
    expect(trailLabelFromTags({ highway: 'path' })).toBeNull();
  });

  it('numeric sac values pass through as T labels', () => {
    expect(trailLabelFromTags({ sac_scale: 'T3' })).toBe('T3');
    expect(trailLabelFromTags({ sac_scale: 'T1' })).toBeNull();
    expect(trailLabelFromTags({ sac_scale: 'weird' })).toBeNull();
  });
});
