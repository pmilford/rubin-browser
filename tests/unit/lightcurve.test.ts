import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildLightCurveAdql,
  parseLightCurveResult,
  toLightCurvePoints,
  fluxToAbMag,
  fetchLightCurve,
  AB_MAG_ZEROPOINT_NJY,
  type LightCurveQueryParams,
} from '../../src/api/lightcurve.js';
import type { TapQueryResult } from '../../src/types/catalog.js';

// query() lives in tap.ts; mock it so fetchLightCurve never hits the network.
vi.mock('../../src/api/tap.js', () => ({
  query: vi.fn(),
}));
import { query } from '../../src/api/tap.js';

/** Extract the CIRCLE radius (last CIRCLE arg) from an ADQL string, as a number. */
function circleRadius(adql: string): number {
  const m = adql.match(/CIRCLE\('ICRS',\s*[-\d.]+,\s*[-\d.]+,\s*([-\d.eE]+)\)/);
  if (!m) throw new Error(`no CIRCLE found in:\n${adql}`);
  return Number(m[1]);
}

/** Build a fixture TAP result from row objects (the shape query() returns). */
function tapResult(rows: Record<string, unknown>[]): TapQueryResult {
  return {
    status: 'completed',
    rowCount: rows.length,
    columns: [],
    rows,
  };
}

describe('buildLightCurveAdql', () => {
  const base: LightCurveQueryParams = { ra: 62.0, dec: -37.0, radiusArcsec: 10 };

  it('cone-searches dp1.Object and JOINs ForcedSource on objectId (NOT a ForcedSource coordinate scan)', () => {
    const adql = buildLightCurveAdql(base);
    // Rubin-mandated pattern: the OBJECT catalog is the FROM/cone table; ForcedSource
    // is JOINED on the id, never cone-searched itself.
    expect(adql).toContain('FROM dp1.Object');
    expect(adql).toContain('JOIN dp1.ForcedSource');
    expect(adql).toMatch(/ON\s+fs\.objectId\s*=\s*obj\.objectId/);
    // Adversarial: the old anti-pattern cone-searched ForcedSource directly. A
    // `FROM dp1.ForcedSource` / `POINT('ICRS', fs.coord_ra, …)` impl MUST fail.
    expect(adql).not.toContain('FROM dp1.ForcedSource');
    expect(adql).not.toContain('POINT(\'ICRS\', fs.coord_ra');
    // Visit join still supplies the MJD.
    expect(adql).toContain('JOIN dp1.Visit');
    expect(adql).toContain('fs.visit = v.visit');
    // The DP0.2 namespace would be the classic wrong-release bug.
    expect(adql).not.toContain('dp02_dc2');
    expect(adql).not.toContain('dp02');
  });

  it('selects the real DP1 light-curve columns (MJD, band, flux, err)', () => {
    const adql = buildLightCurveAdql(base);
    expect(adql).toContain('v.expMidptMJD');
    expect(adql).toContain('fs.band');
    expect(adql).toContain('fs.psfFlux');
    expect(adql).toContain('fs.psfFluxErr');
  });

  it('cone-searches with CONTAINS/POINT/CIRCLE on the OBJECT coords, with NO dangerous ORDER BY', () => {
    const adql = buildLightCurveAdql(base);
    expect(adql).toContain('CONTAINS(');
    // The spatial predicate is on the Object catalog's coords, not ForcedSource's.
    expect(adql).toContain("POINT('ICRS', obj.coord_ra, obj.coord_dec)");
    expect(adql).toContain("CIRCLE('ICRS'");
    // Rubin flags ORDER BY + TOP as dangerous; parseLightCurveResult sorts client-side.
    expect(adql).not.toMatch(/ORDER BY/i);
  });

  it('converts arcsec radius to DEGREES at the boundary (kills a units bug)', () => {
    // 3600 arcsec = exactly 1 degree.
    const adql = buildLightCurveAdql({ ra: 10, dec: 20, radiusArcsec: 3600 });
    expect(circleRadius(adql)).toBeCloseTo(1, 12);
    // A degrees-as-arcsec / no-conversion bug would leave 3600 in the CIRCLE.
    expect(circleRadius(adql)).not.toBe(3600);

    const adql2 = buildLightCurveAdql({ ra: 10, dec: 20, radiusArcsec: 10 });
    expect(circleRadius(adql2)).toBeCloseTo(10 / 3600, 12);
  });

  it('emits ra/dec into the CIRCLE center', () => {
    const adql = buildLightCurveAdql(base);
    expect(adql).toMatch(/CIRCLE\('ICRS',\s*62,\s*-37,/);
  });

  it('adds a band filter only when a band is given, allowlisted', () => {
    expect(buildLightCurveAdql({ ...base, band: 'r' })).toContain("fs.band = 'r'");
    expect(buildLightCurveAdql(base)).not.toContain('fs.band =');
  });

  it('rejects an out-of-allowlist band (injection guard)', () => {
    expect(() =>
      buildLightCurveAdql({ ...base, band: "r'; DROP TABLE dp1.Object;--" })
    ).toThrow(/Invalid band/);
    expect(() => buildLightCurveAdql({ ...base, band: 'q' })).toThrow(/Invalid band/);
  });

  it('rejects non-finite coordinates and non-positive radius', () => {
    expect(() => buildLightCurveAdql({ ...base, ra: NaN })).toThrow(/Invalid ra/);
    expect(() => buildLightCurveAdql({ ...base, dec: Infinity })).toThrow(/Invalid dec/);
    expect(() => buildLightCurveAdql({ ...base, radiusArcsec: 0 })).toThrow(/radiusArcsec/);
    expect(() => buildLightCurveAdql({ ...base, radiusArcsec: -5 })).toThrow(/radiusArcsec/);
  });

  it('supports the DIA variant: cone-search dp1.DiaObject (ra/dec), JOIN ForcedSourceOnDiaObject on diaObjectId', () => {
    const adql = buildLightCurveAdql({ ...base, table: 'dia' });
    expect(adql).toContain('FROM dp1.DiaObject');
    expect(adql).toContain('JOIN dp1.ForcedSourceOnDiaObject');
    expect(adql).toMatch(/ON\s+fs\.diaObjectId\s*=\s*obj\.diaObjectId/);
    // DiaObject exposes ra/dec (not coord_ra/coord_dec) for the spatial cut.
    expect(adql).toContain("POINT('ICRS', obj.ra, obj.dec)");
    // Still NOT a coordinate scan on the forced table.
    expect(adql).not.toContain('FROM dp1.ForcedSourceOnDiaObject');
    expect(adql).toContain('JOIN dp1.Visit');
    expect(adql).not.toMatch(/ORDER BY/i);
  });

  it('respects maxRecords via TOP', () => {
    expect(buildLightCurveAdql({ ...base, maxRecords: 50 })).toContain('SELECT TOP 50');
  });

  it('formats a tiny radius without scientific notation', () => {
    // 0.001 arcsec ≈ 2.78e-7 deg — must not appear as `2.78e-7` in ADQL.
    const adql = buildLightCurveAdql({ ra: 1, dec: 1, radiusArcsec: 0.001 });
    const m = adql.match(/CIRCLE\('ICRS',[^)]*?,\s*([^)]+)\)/);
    expect(m![1]).not.toMatch(/e/i);
  });
});

describe('fluxToAbMag', () => {
  it('applies the nJy AB zeropoint', () => {
    // 3631 Jy = 3.631e12 nJy ⇒ AB mag ≈ 0 (zeropoint 31.4 is rounded to 3 dp).
    expect(fluxToAbMag(3.631e12)).toBeCloseTo(0, 3);
    // A 100× brighter flux is 2.5 mag brighter.
    const m1 = fluxToAbMag(1e6)!;
    const m2 = fluxToAbMag(1e8)!;
    expect(m1 - m2).toBeCloseTo(5, 6);
  });

  it('uses the documented zeropoint constant', () => {
    // flux = 1 nJy ⇒ mag = zeropoint.
    expect(fluxToAbMag(1)).toBeCloseTo(AB_MAG_ZEROPOINT_NJY, 6);
  });

  it('returns null for non-positive / non-finite flux', () => {
    expect(fluxToAbMag(0)).toBeNull();
    expect(fluxToAbMag(-50)).toBeNull();
    expect(fluxToAbMag(NaN)).toBeNull();
  });
});

describe('parseLightCurveResult', () => {
  it('returns time-ordered, per-band series with mags from flux (aliased cols)', () => {
    // Rows deliberately OUT of MJD order and interleaving two bands.
    const raw = tapResult([
      { mjd: 60002, band: 'r', flux: 2000, fluxErr: 20 },
      { mjd: 60000, band: 'g', flux: 1000, fluxErr: 10 },
      { mjd: 60001, band: 'r', flux: 1500, fluxErr: 15 },
      { mjd: 60003, band: 'g', flux: 1200, fluxErr: 12 },
    ]);
    const lc = parseLightCurveResult(raw);

    // Global samples sorted ascending by MJD.
    expect(lc.samples.map((s) => s.mjd)).toEqual([60000, 60001, 60002, 60003]);
    // Per-band grouping, each ascending in MJD.
    expect(lc.bands.sort()).toEqual(['g', 'r']);
    expect(lc.byBand.r!.map((s) => s.mjd)).toEqual([60001, 60002]);
    expect(lc.byBand.g!.map((s) => s.mjd)).toEqual([60000, 60003]);

    // Mag derived from flux: brighter flux ⇒ smaller mag.
    const r = lc.byBand.r!;
    expect(r[0]!.mag!).toBeGreaterThan(r[1]!.mag!); // flux 1500 fainter than 2000
    expect(r[1]!.mag).toBeCloseTo(fluxToAbMag(2000)!, 6);
    // Mag error present and positive.
    expect(r[1]!.magErr!).toBeGreaterThan(0);
  });

  it('parses raw un-aliased DP1 column names too (expMidptMJD/psfFlux)', () => {
    const raw = tapResult([
      { expMidptMJD: 60010, band: 'i', psfFlux: 500, psfFluxErr: 5 },
      { expMidptMJD: 60005, band: 'i', psfFlux: 700, psfFluxErr: 7 },
    ]);
    const lc = parseLightCurveResult(raw);
    expect(lc.samples.map((s) => s.mjd)).toEqual([60005, 60010]);
    expect(lc.samples[0]!.flux).toBe(700);
    expect(lc.samples[0]!.band).toBe('i');
  });

  it('keeps negative diff-flux samples but leaves mag undefined', () => {
    const raw = tapResult([{ mjd: 60000, band: 'r', flux: -30, fluxErr: 10 }]);
    const lc = parseLightCurveResult(raw);
    expect(lc.samples).toHaveLength(1);
    expect(lc.samples[0]!.flux).toBe(-30);
    expect(lc.samples[0]!.mag).toBeUndefined();
  });

  it('skips rows missing mjd/band/flux', () => {
    const raw = tapResult([
      { band: 'r', flux: 100 }, // no mjd
      { mjd: 1, flux: 100 }, // no band
      { mjd: 2, band: 'r' }, // no flux
      { mjd: 3, band: 'r', flux: 100 }, // good
    ]);
    const lc = parseLightCurveResult(raw);
    expect(lc.samples).toHaveLength(1);
    expect(lc.samples[0]!.mjd).toBe(3);
  });

  it('returns empty structure for no rows', () => {
    const lc = parseLightCurveResult(tapResult([]));
    expect(lc.samples).toEqual([]);
    expect(lc.bands).toEqual([]);
    expect(lc.byBand).toEqual({});
  });

  it('throws on a malformed result', () => {
    expect(() => parseLightCurveResult({} as TapQueryResult)).toThrow(/rows/);
  });
});

describe('toLightCurvePoints (adapter to LightCurvePoint)', () => {
  const lc = parseLightCurveResult(
    tapResult([
      { mjd: 60000, band: 'r', flux: 1000, fluxErr: 10 },
      { mjd: 60001, band: 'r', flux: 3000, fluxErr: 10 },
      { mjd: 60002, band: 'r', flux: 2000, fluxErr: 10 },
      { mjd: 60000, band: 'g', flux: 500, fluxErr: 5 },
    ])
  );

  it('produces {mjd, intensity} in time order, intensity = flux', () => {
    const pts = toLightCurvePoints(lc, { band: 'r' });
    expect(pts.map((p) => p.mjd)).toEqual([60000, 60001, 60002]);
    expect(pts.map((p) => p.intensity)).toEqual([1000, 3000, 2000]);
    // Shape matches LightCurvePoint.
    expect(Object.keys(pts[0]!).sort()).toEqual(['intensity', 'mjd']);
  });

  it('flux→intensity is monotonic (sorted flux ⇒ sorted intensity)', () => {
    const fluxes = [10, 100, 1000, 5000];
    const curve = parseLightCurveResult(
      tapResult(fluxes.map((f, i) => ({ mjd: 60000 + i, band: 'r', flux: f })))
    );
    const pts = toLightCurvePoints(curve, { band: 'r' });
    const ints = pts.map((p) => p.intensity);
    for (let i = 1; i < ints.length; i++) {
      expect(ints[i]!).toBeGreaterThan(ints[i - 1]!);
    }
  });

  it('mag→intensity via 10^(-0.4 mag): brighter (lower mag) ⇒ higher intensity', () => {
    // Increasing flux ⇒ decreasing mag ⇒ increasing intensity — monotonic.
    const fluxes = [100, 400, 1600];
    const curve = parseLightCurveResult(
      tapResult(fluxes.map((f, i) => ({ mjd: 60000 + i, band: 'r', flux: f })))
    );
    const pts = toLightCurvePoints(curve, { band: 'r', source: 'mag' });
    const ints = pts.map((p) => p.intensity);
    for (let i = 1; i < ints.length; i++) {
      expect(ints[i]!).toBeGreaterThan(ints[i - 1]!);
    }
    // mag-based intensity is flux scaled by a constant (10^(-0.4·zeropoint)).
    const scale = Math.pow(10, -0.4 * AB_MAG_ZEROPOINT_NJY);
    pts.forEach((p, i) => expect(p.intensity).toBeCloseTo(fluxes[i]! * scale, 12));
  });

  it('filters to a single band and defaults to all samples', () => {
    expect(toLightCurvePoints(lc, { band: 'g' }).map((p) => p.mjd)).toEqual([60000]);
    // No band → all samples (both bands), still MJD-sorted.
    expect(toLightCurvePoints(lc).length).toBe(4);
  });
});

describe('fetchLightCurve', () => {
  const params: LightCurveQueryParams = { ra: 53.1, dec: -28.2, radiusArcsec: 5 };

  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('queries DP1 via the TAP client and returns a parsed curve', async () => {
    vi.mocked(query).mockResolvedValue(
      tapResult([
        { mjd: 60001, band: 'r', flux: 2000, fluxErr: 20 },
        { mjd: 60000, band: 'r', flux: 1000, fluxErr: 10 },
      ])
    );
    const lc = await fetchLightCurve(params);

    // Sent real DP1 ADQL through query().
    const sentAdql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sentAdql).toContain('dp1.ForcedSource');
    // Parsed + time-ordered.
    expect(lc.samples.map((s) => s.mjd)).toEqual([60000, 60001]);
  });

  it('throws an honest error when no epochs are found (never fake data)', async () => {
    vi.mocked(query).mockResolvedValue(tapResult([]));
    await expect(fetchLightCurve(params)).rejects.toThrow(/No DP1 forced-source/);
  });

  it('wraps a TAP failure with a token/rights hint', async () => {
    vi.mocked(query).mockRejectedValue(new Error('TAP query failed (401): Unauthorized'));
    await expect(fetchLightCurve(params)).rejects.toThrow(/DP1 data rights/);
  });
});
