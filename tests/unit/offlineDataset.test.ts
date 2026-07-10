import { describe, it, expect } from 'vitest';
import { offlineSky, offlineTileRGBA, OFFLINE_TILE_SIZE } from '../../src/data/offlineDataset.js';

describe('offline dataset', () => {
  it('generates a stable synthetic sky with sources', () => {
    const a = offlineSky();
    const b = offlineSky();
    expect(a).toBe(b); // memoized singleton
    expect(a.sources.length).toBeGreaterThan(1000);
    for (const s of a.sources) {
      expect(s.ra).toBeGreaterThanOrEqual(0);
      expect(s.ra).toBeLessThan(360);
      expect(s.dec).toBeGreaterThanOrEqual(-90);
      expect(s.dec).toBeLessThanOrEqual(90);
    }
  });

  it('renders a correctly-sized RGBA tile that is deterministic and not blank', () => {
    const t1 = offlineTileRGBA(3, 100);
    const t2 = offlineTileRGBA(3, 100);
    expect(t1.length).toBe(OFFLINE_TILE_SIZE * OFFLINE_TILE_SIZE * 4);
    expect(Array.from(t1)).toEqual(Array.from(t2)); // deterministic
    // The synthetic sky has a background pedestal, so tiles are never all-zero.
    let sum = 0;
    for (let i = 0; i < t1.length; i += 4) sum += t1[i]!;
    expect(sum).toBeGreaterThan(0);
    // Alpha channel is opaque.
    expect(t1[3]).toBe(255);
  });

  it('produces different rasters for different tiles', () => {
    expect(Array.from(offlineTileRGBA(3, 100))).not.toEqual(Array.from(offlineTileRGBA(3, 200)));
  });
});
