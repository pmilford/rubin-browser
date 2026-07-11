import { describe, it, expect } from 'vitest';
import {
  offlineSky,
  offlineTileRGBA,
  OFFLINE_TILE_SIZE,
  OFFLINE_GALAXY,
} from '../../src/data/offlineDataset.js';
import { intensityAt } from '../../src/data/syntheticSky.js';

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

  it('injects the known extended galaxy (feature 123 substrate) at its documented position', () => {
    const sky = offlineSky();
    const galaxy = sky.sources.find((s) => s.morphology?.kind === 'sersic');
    expect(galaxy, 'offline cube must contain the injected Sérsic galaxy').toBeDefined();
    expect(galaxy!.ra).toBeCloseTo(OFFLINE_GALAXY.ra, 6);
    expect(galaxy!.dec).toBeCloseTo(OFFLINE_GALAXY.dec, 6);

    // It is genuinely EXTENDED: intensity is still substantial one effective radius
    // out, unlike a star which is gone within a few arcsec.
    const { ra, dec, reArcsec } = OFFLINE_GALAXY;
    const centre = intensityAt(sky, ra, dec, 'r', 60000);
    const atRe = intensityAt(sky, ra, dec + reArcsec / 3600, 'r', 60000);
    expect(centre).toBeGreaterThan(0);
    expect(atRe / centre).toBeGreaterThan(0.1); // ~0.187 for n=1 (plus faint neighbours)

    // Peak stays below the 8-bit clip so the classifier won't (correctly) flag it
    // saturated — the whole point of choosing mag ~19.5.
    expect(centre).toBeLessThan(255);
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
