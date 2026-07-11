import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGaiaEpochPhotometry, GAIA_DR2_ZERO_POINT } from '../../src/api/gaiaLightCurve.js';

/**
 * REAL-DATA regression for the Gaia DR2 epoch-photometry parser. The fixture is a
 * VERBATIM live GAVO response (gaia.dr2epochflux JOIN gaia.dr2light, a 5" cone at
 * a known DR2 variable, 2026-07). It locks the real ARRAY-valued wire shape
 * (one row per source; parallel g/bp/rp time+flux arrays) and the flux→mag
 * conversion — the class a hand-invented mock would get wrong.
 */
const raw = JSON.parse(readFileSync('tests/fixtures/gaia-dr2-epochflux.json', 'utf-8'));

describe('Gaia DR2 epoch photometry — real-response regression', () => {
  it('exposes the array-valued wire shape (one source row, parallel arrays)', () => {
    expect(Array.isArray(raw.columns)).toBe(true);
    expect(raw.columns.map((c: { name: string }) => c.name)).toContain('g_transit_flux');
    expect(raw.data.length).toBe(1); // one source in this cone
    expect(Array.isArray(raw.data[0][1])).toBe(true); // g_transit_time is an ARRAY
  });

  it('parses the multi-band light curve with the correct transit counts', () => {
    const vars = parseGaiaEpochPhotometry(raw);
    expect(vars.length).toBe(1);
    const v = vars[0]!;
    // Captured live: 19 G, 11 BP, 12 RP transits (all fluxes finite/positive).
    expect(v.g.length).toBe(19);
    expect(v.bp.length).toBe(11);
    expect(v.rp.length).toBe(12);
    expect(v.nEpochs).toBe(19 + 11 + 12);
  });

  it('converts flux → magnitude with the DR2 zero point and orders by time', () => {
    const v = parseGaiaEpochPhotometry(raw)[0]!;
    // The first G point: flux 157.2741 e-/s → G ≈ 25.6884 − 2.5·log10(157.27).
    const expectedMag = GAIA_DR2_ZERO_POINT.g - 2.5 * Math.log10(157.2741);
    // Points are time-ordered; the earliest G transit is the 157.27-flux one.
    expect(v.g[0]!.intensity).toBeCloseTo(157.2741, 3);
    expect(v.g[0]!.mag).toBeCloseTo(expectedMag, 4);
    expect(v.g[0]!.mag).toBeGreaterThan(19); // a faint (~20 mag) variable
    // MJD is monotonically increasing (time-ordered).
    for (let i = 1; i < v.g.length; i++) expect(v.g[i]!.mjd).toBeGreaterThanOrEqual(v.g[i - 1]!.mjd);
  });
});
