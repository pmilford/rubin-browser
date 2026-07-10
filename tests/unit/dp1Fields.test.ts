import { describe, it, expect } from 'vitest';
import { DP1_FIELDS, DP1_TOTAL_AREA_DEG2 } from '../../src/data/dp1Fields.js';

describe('DP1_FIELDS', () => {
  it('lists exactly the seven DP1 fields', () => {
    // DP1 is seven ~1 deg² fields. A truncated/garbled table fails here.
    expect(DP1_FIELDS).toHaveLength(7);
  });

  it('has unique ids', () => {
    const ids = DP1_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every field has valid ICRS coordinates', () => {
    // Kills a swapped ra/dec or a NaN from a bad parse.
    for (const f of DP1_FIELDS) {
      expect(f.ra).toBeGreaterThanOrEqual(0);
      expect(f.ra).toBeLessThan(360);
      expect(f.dec).toBeGreaterThanOrEqual(-90);
      expect(f.dec).toBeLessThanOrEqual(90);
      expect(Number.isFinite(f.ra) && Number.isFinite(f.dec)).toBe(true);
    }
  });

  it('has the known ECDFS and 47 Tuc centres', () => {
    // Concrete reference values (arXiv:2603.23786 / dp1.lsst.io) — kills a
    // placeholder/zeroed table that would still have length 7.
    const ecdfs = DP1_FIELDS.find((f) => f.id === 'ecdfs')!;
    expect(ecdfs.ra).toBeCloseTo(53.13, 2);
    expect(ecdfs.dec).toBeCloseTo(-28.1, 2);
    const tuc = DP1_FIELDS.find((f) => f.id === '47tuc')!;
    expect(tuc.ra).toBeCloseTo(6.02, 2);
    expect(tuc.dec).toBeCloseTo(-72.08, 2);
  });

  it('reports the ~15 deg² total coverage (not all-sky)', () => {
    expect(DP1_TOTAL_AREA_DEG2).toBeGreaterThan(0);
    expect(DP1_TOTAL_AREA_DEG2).toBeLessThan(50); // NOT almost-full-sky
  });
});
