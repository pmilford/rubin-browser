import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildObjectConeSearch,
  parseRubinObjects,
  fetchRubinObjects,
  fetchNearestRubinObject,
  RUBIN_OBJECT_BANDS,
  RUBIN_OBJECT_COLUMNS,
} from '../../src/api/rubinObjects.js';
import type { TapQueryResult } from '../../src/types/catalog.js';

// tap.query and auth.isAuthenticated are mocked so fetchRubinObjects is tested
// without a network or a real token.
vi.mock('../../src/api/tap.js', () => ({ query: vi.fn() }));
vi.mock('../../src/api/auth.js', () => ({ isAuthenticated: vi.fn() }));

import { query } from '../../src/api/tap.js';
import { isAuthenticated } from '../../src/api/auth.js';

const mockedQuery = vi.mocked(query);
const mockedIsAuth = vi.mocked(isAuthenticated);

/* ------------------------------------------------------------------ */
/* buildObjectConeSearch — pure ADQL                                  */
/* ------------------------------------------------------------------ */

describe('buildObjectConeSearch', () => {
  const params = { ra: 53.13, dec: -28.1, radiusDeg: 0.05, maxRows: 500 };

  it('queries FROM dp1.Object (DP1 schema, not DP0.2)', () => {
    const adql = buildObjectConeSearch(params);
    expect(adql).toContain('FROM dp1.Object');
    expect(adql).not.toContain('dp02');
    expect(adql).not.toContain('dp02_dc2_catalogs');
  });

  it('emits the CONTAINS(POINT coord_ra/coord_dec, CIRCLE) spatial predicate at the EXACT ra/dec/radius in DEGREES', () => {
    const adql = buildObjectConeSearch(params);
    // POINT on the object's own coord_ra/coord_dec (the canonical DP1 index columns).
    expect(adql).toContain("POINT('ICRS', coord_ra, coord_dec)");
    // CIRCLE at the exact centre + radius — radius is DEGREES verbatim (NOT /3600).
    expect(adql).toContain("CIRCLE('ICRS', 53.13, -28.1, 0.05)");
    expect(adql).toMatch(/CONTAINS\([\s\S]*\)\s*=\s*1/);
    // Guard against an accidental arcsec→deg division sneaking in.
    expect(adql).not.toContain('/ 3600');
    expect(adql).not.toContain((0.05 / 3600).toString());
  });

  it('selects EXPLICIT verified columns (objectId, coord_ra/dec, per-band psf mags, r cModel) — never SELECT *', () => {
    const adql = buildObjectConeSearch(params);
    expect(adql).not.toContain('SELECT *');
    expect(adql).toMatch(/^SELECT TOP 500/);
    expect(adql).toContain('objectId');
    expect(adql).toContain('coord_ra');
    expect(adql).toContain('coord_dec');
    expect(adql).toContain('refBand');
    for (const b of RUBIN_OBJECT_BANDS) {
      expect(adql).toContain(`${b}_psfMag`);
    }
    expect(adql).toContain('r_cModelMag');
    // The column list is the single source of truth.
    for (const c of RUBIN_OBJECT_COLUMNS) expect(adql).toContain(c);
  });

  it('has NO ORDER BY (Rubin flags ORDER BY + TOP as dangerous)', () => {
    const adql = buildObjectConeSearch(params);
    expect(adql).not.toMatch(/ORDER BY/i);
  });

  // Kills an impl that omits the primary-detection cut: without detect_isPrimary=1
  // the deep-coadd cone returns blended-parent AND deblended-child rows stacked at
  // the same position, so the overlay draws overlapping DUPLICATE markers ("spam
  // noise"). The project's own rule: "Use detect_isPrimary = 1 to avoid duplicates".
  it('filters to primary detections only (detect_isPrimary = 1) to avoid duplicate/deblend-child markers', () => {
    const adql = buildObjectConeSearch(params);
    expect(adql).toMatch(/AND\s+detect_isPrimary\s*=\s*1/);
    // It must be AND-ed onto the cone (a WHERE-replacing bug would drop the cone).
    expect(adql).toContain('CONTAINS(');
  });

  it('honours maxRows via TOP, defaulting when omitted', () => {
    expect(buildObjectConeSearch({ ra: 10, dec: 10, radiusDeg: 0.1 })).toMatch(/SELECT TOP 2000/);
    expect(buildObjectConeSearch({ ra: 10, dec: 10, radiusDeg: 0.1, maxRows: 7 })).toMatch(
      /SELECT TOP 7/
    );
  });

  it('throws on a non-finite ra/dec/radius (no NaN/Infinity interpolated)', () => {
    expect(() => buildObjectConeSearch({ ra: NaN, dec: 0, radiusDeg: 0.1 })).toThrow(/Invalid ra/);
    expect(() => buildObjectConeSearch({ ra: 0, dec: Infinity, radiusDeg: 0.1 })).toThrow(
      /Invalid dec/
    );
    expect(() =>
      buildObjectConeSearch({ ra: 0, dec: 0, radiusDeg: Number.NaN })
    ).toThrow(/Invalid radiusDeg/);
  });

  it('throws on a non-positive radius', () => {
    expect(() => buildObjectConeSearch({ ra: 0, dec: 0, radiusDeg: 0 })).toThrow(
      /must be > 0/
    );
    expect(() => buildObjectConeSearch({ ra: 0, dec: 0, radiusDeg: -1 })).toThrow(/must be > 0/);
  });
});

/* ------------------------------------------------------------------ */
/* parseRubinObjects — TAP rows → CatalogSet                          */
/* ------------------------------------------------------------------ */

function tapResult(rows: Record<string, unknown>[]): TapQueryResult {
  return { status: 'completed', rowCount: rows.length, columns: [], rows };
}

describe('parseRubinObjects', () => {
  it('maps rows to the exact CatalogSet values (position, label, records)', () => {
    const raw = tapResult([
      {
        objectId: '611253571010494475',
        coord_ra: 53.15,
        coord_dec: -28.05,
        refBand: 'i',
        u_psfMag: 24.1,
        g_psfMag: 23.2,
        r_psfMag: 22.5,
        i_psfMag: 22.0,
        z_psfMag: 21.8,
        y_psfMag: 21.6,
        r_cModelMag: 21.9,
      },
    ]);
    const set = parseRubinObjects(raw);

    expect(set.count).toBe(1);
    expect(set.ra[0]).toBeCloseTo(53.15, 4);
    expect(set.dec[0]).toBeCloseTo(-28.05, 4);
    // 64-bit id preserved as an exact decimal string (no precision loss).
    expect(set.label[0]).toBe('611253571010494475');

    const rec = set.records[0]!;
    expect(rec['Catalog']).toBe('Rubin DP1 Object');
    expect(rec['Object ID']).toBe('611253571010494475');
    expect(rec['Ref band']).toBe('i');
    expect(rec['r (psf mag)']).toBeCloseTo(22.5, 4);
    expect(rec['y (psf mag)']).toBeCloseTo(21.6, 4);
    expect(rec['r (cModel mag)']).toBeCloseTo(21.9, 4);
  });

  it('empty rows → a VALID empty catalog (count 0), never a throw', () => {
    const set = parseRubinObjects(tapResult([]));
    expect(set.count).toBe(0);
    expect(set.ra.length).toBe(0);
    expect(set.records.length).toBe(0);
  });

  it('renders a null/absent band magnitude as the no-data dash, never NaN', () => {
    const set = parseRubinObjects(
      tapResult([{ objectId: '1', coord_ra: 10, coord_dec: 20, r_psfMag: null }])
    );
    const rec = set.records[0]!;
    expect(rec['u (psf mag)']).toBe('—');
    expect(rec['r (psf mag)']).toBe('—');
    // No raw NaN ever leaks into a table cell.
    for (const v of Object.values(rec)) expect(Number.isNaN(v as number)).toBe(false);
  });

  it('normalises RA into [0,360)', () => {
    const set = parseRubinObjects(tapResult([{ objectId: '1', coord_ra: -5, coord_dec: 0 }]));
    expect(set.ra[0]).toBeCloseTo(355, 4);
  });

  it('throws on a row missing coord_ra/coord_dec (schema mismatch, not silent NaN)', () => {
    expect(() =>
      parseRubinObjects(tapResult([{ objectId: '1', g_psfMag: 22 }]))
    ).toThrow(/unexpected columns/i);
  });

  it('stringifies a numeric objectId and dashes an absent one / absent refBand', () => {
    const numeric = parseRubinObjects(tapResult([{ objectId: 42, coord_ra: 10, coord_dec: 20 }]));
    expect(numeric.label[0]).toBe('42');
    // objectId absent entirely → empty label, dash in the table cell; refBand absent → dash.
    const missing = parseRubinObjects(tapResult([{ coord_ra: 10, coord_dec: 20 }]));
    expect(missing.label[0]).toBe('');
    expect(missing.records[0]!['Object ID']).toBe('—');
    expect(missing.records[0]!['Ref band']).toBe('—');
  });

  it('throws on a non-object row (never writes NaN coordinates)', () => {
    // @ts-expect-error deliberately malformed row
    expect(() => parseRubinObjects(tapResult([null]))).toThrow(/is not an object/);
  });

  it('throws on a malformed result (no rows array)', () => {
    // @ts-expect-error deliberately malformed
    expect(() => parseRubinObjects({ status: 'completed' })).toThrow(/rows array/);
  });
});

/* ------------------------------------------------------------------ */
/* fetchRubinObjects — auth gate + adapter                            */
/* ------------------------------------------------------------------ */

describe('fetchRubinObjects', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedIsAuth.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('throws the honest sign-in error BEFORE ever calling query() when unauthenticated', async () => {
    mockedIsAuth.mockReturnValue(false);
    await expect(
      fetchRubinObjects({ ra: 53.13, dec: -28.1, radiusDeg: 0.05 })
    ).rejects.toThrow(/RSP token that has DP1 data rights/i);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('authenticated: runs the query and maps the TAP rows into a CatalogSet', async () => {
    mockedIsAuth.mockReturnValue(true);
    mockedQuery.mockResolvedValue(
      tapResult([
        { objectId: '42', coord_ra: 53.1, coord_dec: -28.0, refBand: 'r', r_psfMag: 20.0 },
      ])
    );
    const set = await fetchRubinObjects({ ra: 53.13, dec: -28.1, radiusDeg: 0.05, maxRows: 100 });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const adql = mockedQuery.mock.calls[0]![0] as string;
    expect(adql).toContain('FROM dp1.Object');
    expect(set.count).toBe(1);
    expect(set.label[0]).toBe('42');
    expect(set.records[0]!['r (psf mag)']).toBeCloseTo(20.0, 4);
  });

  it('authenticated empty field → a VALID empty CatalogSet (count 0), not an error', async () => {
    mockedIsAuth.mockReturnValue(true);
    mockedQuery.mockResolvedValue(tapResult([]));
    const set = await fetchRubinObjects({ ra: 0, dec: 0, radiusDeg: 0.05 });
    expect(set.count).toBe(0);
  });

  it('maps a 401 from query() to an honest "missing DP1 data rights" error', async () => {
    mockedIsAuth.mockReturnValue(true);
    mockedQuery.mockRejectedValue(new Error('TAP query failed (401): Unauthorized'));
    await expect(
      fetchRubinObjects({ ra: 53.13, dec: -28.1, radiusDeg: 0.05 })
    ).rejects.toThrow(/401.*DP1 data rights/is);
  });

  it('maps a 404 from query() to an honest "table not found" error', async () => {
    mockedIsAuth.mockReturnValue(true);
    mockedQuery.mockRejectedValue(new Error('TAP query failed (404): Not Found'));
    await expect(
      fetchRubinObjects({ ra: 53.13, dec: -28.1, radiusDeg: 0.05 })
    ).rejects.toThrow(/not found \(404\)/i);
  });

  it('wraps any other query() failure as an honest network error (never fake data)', async () => {
    mockedIsAuth.mockReturnValue(true);
    mockedQuery.mockRejectedValue(new Error('Failed to fetch'));
    await expect(
      fetchRubinObjects({ ra: 53.13, dec: -28.1, radiusDeg: 0.05 })
    ).rejects.toThrow(/Network error fetching DP1 Objects/i);
  });
});

describe('buildObjectConeSearch — refExtendedness column (recognizer fix)', () => {
  it('selects refExtendedness (Rubin\'s own star/galaxy flag)', () => {
    const adql = buildObjectConeSearch({ ra: 53.13, dec: -28.1, radiusDeg: 0.001 });
    expect(adql).toContain('refExtendedness');
    expect(RUBIN_OBJECT_COLUMNS).toContain('refExtendedness');
  });
});

describe('fetchNearestRubinObject', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('throws sign-in-required and does NOT query when unauthenticated', async () => {
    mockedIsAuth.mockReturnValue(false);
    await expect(fetchNearestRubinObject({ ra: 53.13, dec: -28.1 })).rejects.toThrow(/Sign-in required/i);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('returns the NEAREST object to the click with its refExtendedness (a farther one does not win)', async () => {
    mockedIsAuth.mockReturnValue(true);
    // Two objects: one ~1″ away (extended galaxy), one ~2.5″ away (star). Nearest wins.
    mockedQuery.mockResolvedValue(tapResult([
      { objectId: '111', coord_ra: 53.1303, coord_dec: -28.1, refExtendedness: 0, r_cModelMag: 21.0 },   // ~0.95″ E
      { objectId: '222', coord_ra: 53.13, coord_dec: -28.10070, refExtendedness: 1, r_cModelMag: 22.5 }, // ~2.5″ S
    ]));
    const m = await fetchNearestRubinObject({ ra: 53.13, dec: -28.1, radiusArcsec: 3 });
    expect(m).not.toBeNull();
    expect(m!.objectId).toBe('111');
    expect(m!.extendedness).toBe(0); // the nearest object's flag (star)
    expect(m!.separationArcsec).toBeLessThan(2);
    expect(m!.rMag).toBe(21.0);
  });

  it('carries a galaxy extendedness=1 through unchanged (the fix drives a galaxy call)', async () => {
    mockedIsAuth.mockReturnValue(true);
    mockedQuery.mockResolvedValue(tapResult([
      { objectId: '999', coord_ra: 53.13, coord_dec: -28.1, refExtendedness: 1, r_cModelMag: 20.2 },
    ]));
    const m = await fetchNearestRubinObject({ ra: 53.13, dec: -28.1 });
    expect(m!.extendedness).toBe(1);
    expect(m!.separationArcsec).toBeLessThan(0.5);
  });

  it('returns null (not an error) for an empty cone — caller keeps morphology', async () => {
    mockedIsAuth.mockReturnValue(true);
    mockedQuery.mockResolvedValue(tapResult([]));
    expect(await fetchNearestRubinObject({ ra: 53.13, dec: -28.1 })).toBeNull();
  });

  it('surfaces a null refExtendedness as null (faint/unmeasured → no override)', async () => {
    mockedIsAuth.mockReturnValue(true);
    mockedQuery.mockResolvedValue(tapResult([
      { objectId: '333', coord_ra: 53.13, coord_dec: -28.1, refExtendedness: null, r_cModelMag: 24.9 },
    ]));
    const m = await fetchNearestRubinObject({ ra: 53.13, dec: -28.1 });
    expect(m!.extendedness).toBeNull();
  });
});
