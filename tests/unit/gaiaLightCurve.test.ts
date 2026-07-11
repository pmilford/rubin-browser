import { describe, it, expect } from 'vitest';
import {
  buildGaiaEpochPhotometryAdql,
  parseGaiaEpochPhotometry,
  GAIA_DR2_ZERO_POINT,
} from '../../src/api/gaiaLightCurve.js';

describe('buildGaiaEpochPhotometryAdql', () => {
  const base = { ra: 35.25, dec: -24.55, radiusArcsec: 6 };

  it('cone-searches dr2epochflux JOINed with dr2light for position, radius arcsec→deg', () => {
    const adql = buildGaiaEpochPhotometryAdql(base);
    expect(adql).toContain('FROM gaia.dr2epochflux');
    expect(adql).toContain('JOIN gaia.dr2light');
    expect(adql).toContain("CONTAINS(POINT('ICRS', l.ra, l.dec)");
    // 6 arcsec → 6/3600 deg.
    expect(adql).toContain(String(6 / 3600));
  });

  it('caps sources with TOP and rejects bad inputs', () => {
    expect(buildGaiaEpochPhotometryAdql({ ...base, maxSources: 5 })).toContain('SELECT TOP 5');
    expect(() => buildGaiaEpochPhotometryAdql({ ...base, ra: NaN })).toThrow(/Invalid ra/);
    expect(() => buildGaiaEpochPhotometryAdql({ ...base, radiusArcsec: 0 })).toThrow(/radiusArcsec/);
  });
});

describe('parseGaiaEpochPhotometry', () => {
  const cols = [
    { name: 'source_id' },
    { name: 'g_transit_time' },
    { name: 'g_transit_flux' },
    { name: 'bp_obs_time' },
    { name: 'bp_flux' },
    { name: 'rp_obs_time' },
    { name: 'rp_flux' },
  ];

  it('zips parallel time/flux arrays, drops null/≤0 fluxes, converts to mag, sorts by time', () => {
    const raw = {
      columns: cols,
      data: [
        [
          123,
          [200, 100, 150], // times (out of order)
          [100, null, -5], // fluxes: only the first (t=200) is valid
          [100],
          [50],
          [],
          [],
        ],
      ],
    };
    const [v] = parseGaiaEpochPhotometry(raw);
    expect(v!.g.length).toBe(1); // null and negative flux dropped
    expect(v!.g[0]!.intensity).toBe(100);
    expect(v!.g[0]!.mag).toBeCloseTo(GAIA_DR2_ZERO_POINT.g - 2.5 * Math.log10(100), 6);
    expect(v!.bp.length).toBe(1);
    expect(v!.rp.length).toBe(0);
    expect(v!.nEpochs).toBe(2);
  });

  it('returns [] for empty data and accepts the ESA `metadata` descriptor key too', () => {
    expect(parseGaiaEpochPhotometry({ columns: cols, data: [] })).toEqual([]);
    const esa = { metadata: cols, data: [[1, [10], [100], [], [], [], []]] };
    expect(parseGaiaEpochPhotometry(esa)[0]!.g.length).toBe(1);
  });

  it('throws on a non-object body or missing column descriptors', () => {
    expect(() => parseGaiaEpochPhotometry(null)).toThrow(/expected a Gaia TAP JSON object/);
    expect(() => parseGaiaEpochPhotometry({ data: [] })).toThrow(/column descriptors/);
  });
});
