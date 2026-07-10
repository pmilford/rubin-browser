import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildGaiaConeAdql,
  buildGaiaQsoAdql,
  parseGaiaResponse,
  fetchGaiaCone,
  GAIA_TAP_SYNC_URL,
  type GaiaConeParams,
} from '../../src/api/gaia.js';

/** Extract the three CIRCLE args (ra, dec, radius) from an ADQL string. */
function circleArgs(adql: string): [number, number, number] {
  const m = adql.match(/CIRCLE\('ICRS',\s*([-\d.eE]+),\s*([-\d.eE]+),\s*([-\d.eE]+)\)/);
  if (!m) throw new Error(`no CIRCLE found in:\n${adql}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Build a Gaia-shaped TAP JSON result from a column-name list and rows-as-arrays.
 * Mirrors the real `{ metadata:[{name}], data:[[...]] }` shape.
 */
function gaiaJson(names: string[], rows: unknown[][]): unknown {
  return {
    metadata: names.map((name) => ({ name, datatype: 'double' })),
    data: rows,
  };
}

describe('buildGaiaConeAdql', () => {
  const base: GaiaConeParams = { ra: 265.0, dec: -28.0, radiusDeg: 0.1 };

  it('targets gaiadr3.gaia_source (the star catalog)', () => {
    const adql = buildGaiaConeAdql(base);
    expect(adql).toContain('FROM gaiadr3.gaia_source');
    expect(adql).not.toContain('dp1.');
    expect(adql).not.toContain('dp02');
  });

  // Kills a cone that drops/mangles the exact ra/dec/radius the caller asked for.
  it('cone-searches with CONTAINS/POINT/CIRCLE at the EXACT ra/dec/radius (degrees)', () => {
    const adql = buildGaiaConeAdql(base);
    expect(adql).toContain('CONTAINS(');
    expect(adql).toContain("POINT('ICRS', ra, dec)");
    expect(adql).toContain("CIRCLE('ICRS'");
    const [ra, dec, radius] = circleArgs(adql);
    expect(ra).toBe(265.0);
    expect(dec).toBe(-28.0);
    // radiusDeg is already degrees — must NOT be divided/converted (e.g. /3600).
    expect(radius).toBeCloseTo(0.1, 12);
    expect(radius).not.toBeCloseTo(0.1 / 3600, 12);
  });

  it('selects the astrometry + three-band photometry columns', () => {
    const adql = buildGaiaConeAdql(base);
    for (const col of [
      'source_id',
      'ra',
      'dec',
      'parallax',
      'pmra',
      'pmdec',
      'phot_g_mean_mag',
      'bp_rp',
      'radial_velocity',
      'teff_gspphot',
    ]) {
      expect(adql).toContain(col);
    }
  });

  // Kills an uncapped query (which could pull the whole Gaia catalog).
  it('caps rows via TOP/maxRows with a sane default', () => {
    expect(buildGaiaConeAdql(base)).toMatch(/SELECT TOP \d+/);
    expect(buildGaiaConeAdql({ ...base, maxRows: 250 })).toContain('SELECT TOP 250');
  });

  // Kills a missing-mag-filter impl and one that filters even when unbounded.
  it('emits a G-mag cut ONLY when magLimit is given', () => {
    expect(buildGaiaConeAdql(base)).not.toContain('phot_g_mean_mag <');
    const cut = buildGaiaConeAdql({ ...base, magLimit: 18 });
    expect(cut).toContain('phot_g_mean_mag < 18');
  });

  it('rejects non-finite coordinates and non-positive radius', () => {
    expect(() => buildGaiaConeAdql({ ...base, ra: NaN })).toThrow(/Invalid ra/);
    expect(() => buildGaiaConeAdql({ ...base, dec: Infinity })).toThrow(/Invalid dec/);
    expect(() => buildGaiaConeAdql({ ...base, radiusDeg: 0 })).toThrow(/radiusDeg/);
    expect(() => buildGaiaConeAdql({ ...base, radiusDeg: -1 })).toThrow(/radiusDeg/);
  });
});

// ADVERSARIAL honesty constraint: stars have no redshift; only the QSO subset does.
describe('star-vs-QSO redshift honesty', () => {
  const base: GaiaConeParams = { ra: 265.0, dec: -28.0, radiusDeg: 0.1 };

  it('buildGaiaConeAdql (stars) NEVER references redshift', () => {
    const adql = buildGaiaConeAdql(base);
    expect(adql.toLowerCase()).not.toContain('redshift');
    expect(adql).not.toContain('qso');
    expect(adql).not.toContain('galaxy_candidates');
  });

  it('buildGaiaQsoAdql targets qso_candidates and DOES select redshift_qsoc', () => {
    const adql = buildGaiaQsoAdql(base);
    expect(adql).toContain('FROM gaiadr3.qso_candidates');
    expect(adql).toContain('redshift_qsoc');
    // Same cone geometry, same degrees.
    const [ra, dec, radius] = circleArgs(adql);
    expect(ra).toBe(265.0);
    expect(dec).toBe(-28.0);
    expect(radius).toBeCloseTo(0.1, 12);
    // Still capped.
    expect(adql).toMatch(/SELECT TOP \d+/);
  });
});

describe('parseGaiaResponse', () => {
  const cols = [
    'source_id',
    'ra',
    'dec',
    'parallax',
    'pmra',
    'pmdec',
    'phot_g_mean_mag',
    'bp_rp',
    'radial_velocity',
    'teff_gspphot',
  ];

  it('maps a 2-row fixture to the columnar catalog with EXACT values', () => {
    const raw = gaiaJson(cols, [
      ['4472832130942575872', 265.1, -28.2, 3.5, 10.0, -5.0, 15.2, 1.1, 12.3, 5200],
      ['4472832130942575873', 265.2, -28.3, 1.2, -2.0, 4.0, 18.9, 0.7, -8.0, 4800],
    ]);
    const cat = parseGaiaResponse(raw);

    expect(cat.count).toBe(2);
    expect(cat.ra.length).toBe(2);
    expect(Array.from(cat.ra)).toEqual([Math.fround(265.1), Math.fround(265.2)]);
    expect(Array.from(cat.dec)).toEqual([Math.fround(-28.2), Math.fround(-28.3)]);
    expect(cat.gMag[0]).toBeCloseTo(15.2, 4);
    expect(cat.bpRp[1]).toBeCloseTo(0.7, 4);
    expect(cat.pmRa[0]).toBeCloseTo(10.0, 4);
    expect(cat.pmDec[1]).toBeCloseTo(4.0, 4);
    expect(cat.parallax[0]).toBeCloseTo(3.5, 4);
    expect(cat.radialVelocity[0]).toBeCloseTo(12.3, 4);
    expect(cat.teff[1]).toBeCloseTo(4800, 1);
  });

  // ADVERSARIAL: reorder the metadata array and prove mapping is BY NAME, not index.
  it('maps columns BY NAME even when the metadata order is shuffled', () => {
    // dec first, then ra, then g-mag, then source_id — deliberately not SELECT order.
    const raw = gaiaJson(
      ['dec', 'ra', 'phot_g_mean_mag', 'source_id'],
      [[-28.2, 265.1, 15.2, '4472832130942575872']]
    );
    const cat = parseGaiaResponse(raw);
    // A positional impl would put -28.2 in .ra; a by-name impl puts 265.1 in .ra.
    expect(cat.ra[0]).toBeCloseTo(265.1, 4);
    expect(cat.dec[0]).toBeCloseTo(-28.2, 4);
    expect(cat.gMag[0]).toBeCloseTo(15.2, 4);
    expect(cat.sourceId[0]).toBe('4472832130942575872');
  });

  // Kills an impl that coerces the 64-bit id through a JS number and loses digits.
  it('preserves source_id as a string without precision loss', () => {
    const bigId = '4472832130942575872';
    // Sanity: this id is NOT representable exactly as a JS number.
    expect(String(Number(bigId))).not.toBe(bigId);
    const cat = parseGaiaResponse(gaiaJson(['source_id', 'ra', 'dec'], [[bigId, 10, 20]]));
    expect(cat.sourceId[0]).toBe(bigId);
  });

  it('maps null / missing numeric cells to NaN (real Gaia leaves RV, Teff null)', () => {
    const raw = gaiaJson(cols, [
      ['1', 10, 20, null, null, null, 19.0, null, null, null],
    ]);
    const cat = parseGaiaResponse(raw);
    expect(cat.gMag[0]).toBeCloseTo(19.0, 4);
    expect(Number.isNaN(cat.parallax[0])).toBe(true);
    expect(Number.isNaN(cat.bpRp[0])).toBe(true);
    expect(Number.isNaN(cat.radialVelocity[0])).toBe(true);
    expect(Number.isNaN(cat.teff[0])).toBe(true);
    // Position still real.
    expect(cat.ra[0]).toBeCloseTo(10, 4);
  });

  it('normalizes RA into [0,360)', () => {
    const cat = parseGaiaResponse(gaiaJson(['source_id', 'ra', 'dec'], [['1', -10, 0]]));
    expect(cat.ra[0]).toBeCloseTo(350, 3);
  });

  // Empty field is honest data, not an error.
  it('returns a VALID empty catalog (count 0) for data:[] with valid metadata', () => {
    const cat = parseGaiaResponse(gaiaJson(cols, []));
    expect(cat.count).toBe(0);
    expect(cat.ra.length).toBe(0);
    expect(cat.sourceId.length).toBe(0);
  });

  // Kills an impl that silently returns an empty catalog for a malformed body.
  it('throws on malformed responses (no/empty metadata, no ra/dec column)', () => {
    expect(() => parseGaiaResponse({ data: [] })).toThrow(/metadata/);
    expect(() => parseGaiaResponse({ metadata: [], data: [] })).toThrow(/metadata/);
    expect(() => parseGaiaResponse(null)).toThrow(/metadata|Gaia/);
    // Valid, non-empty metadata but no positional columns → schema mismatch.
    expect(() =>
      parseGaiaResponse(gaiaJson(['source_id', 'phot_g_mean_mag'], [['1', 15]]))
    ).toThrow(/ra.*dec|dec/);
  });
});

describe('fetchGaiaCone', () => {
  const params: GaiaConeParams = { ra: 265.0, dec: -28.0, radiusDeg: 0.05 };
  const okJson = gaiaJson(
    ['source_id', 'ra', 'dec', 'phot_g_mean_mag'],
    [
      ['4472832130942575872', 265.01, -28.01, 15.0],
      ['4472832130942575873', 265.02, -28.02, 16.0],
    ]
  );

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs ADQL to the public Gaia endpoint and returns a parsed catalog', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(okJson),
    });

    const cat = await fetchGaiaCone(params);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(GAIA_TAP_SYNC_URL);
    expect(init?.method).toBe('POST');
    // Body carries the ADQL cone.
    const body = String(init?.body);
    expect(body).toContain('LANG=ADQL');
    expect(body).toContain('REQUEST=doQuery');
    expect(decodeURIComponent(body)).toContain('gaiadr3.gaia_source');

    expect(cat.count).toBe(2);
    expect(cat.sourceId[0]).toBe('4472832130942575872');
    expect(cat.gMag[1]).toBeCloseTo(16.0, 4);
  });

  // Kills any impl that leaks the Rubin RSP token to the public ESA service.
  it('sends NO Authorization header (Gaia is a public service)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(okJson),
    });

    await fetchGaiaCone(params);
    const init = vi.mocked(fetch).mock.calls[0]![1];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    // No Authorization under any casing.
    const keys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(keys).not.toContain('authorization');
  });

  it('throws with the status code on a non-ok response (e.g. 500)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    });
    await expect(fetchGaiaCone(params)).rejects.toThrow(/500/);
    await expect(fetchGaiaCone(params)).rejects.toThrow(/boom/);
  });

  it('throws a "could not reach" error when fetch rejects (network/CORS)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchGaiaCone(params)).rejects.toThrow(/could not reach the Gaia TAP/i);
  });

  it('returns a valid empty catalog (count 0) for an empty field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(gaiaJson(['source_id', 'ra', 'dec'], [])),
    });
    const cat = await fetchGaiaCone(params);
    expect(cat.count).toBe(0);
    expect(cat.ra.length).toBe(0);
  });
});
