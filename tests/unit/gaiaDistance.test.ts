import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildGaiaDistanceConeAdql,
  parseGaiaDistances,
  fetchNearestGaiaDistance,
  GAIA_DIST_TABLE,
} from '../../src/api/gaiaDistance.js';

/* -------------------------------------------------------------------------- */
/* buildGaiaDistanceConeAdql                                                  */
/* -------------------------------------------------------------------------- */

describe('buildGaiaDistanceConeAdql', () => {
  const base = { ra: 101.287, dec: -16.716, radiusDeg: 0.02 };

  it('cone-searches gedr3dist.litewithdist selecting the six distance columns', () => {
    const adql = buildGaiaDistanceConeAdql(base);
    expect(adql).toContain(`FROM ${GAIA_DIST_TABLE}`);
    expect(adql).toContain("CONTAINS(\n  POINT('ICRS', ra, dec)");
    expect(adql).toContain("CIRCLE('ICRS', 101.287, -16.716, 0.02)");
    // Both posteriors, med + lo + hi, in the SELECT.
    for (const col of [
      'r_med_geo',
      'r_lo_geo',
      'r_hi_geo',
      'r_med_photogeo',
      'r_lo_photogeo',
      'r_hi_photogeo',
      'phot_g_mean_mag',
    ]) {
      expect(adql).toContain(col);
    }
  });

  it("selects source_id as TEXT (the `source_id || ''` idiom) so the 64-bit id survives JSON.parse", () => {
    expect(buildGaiaDistanceConeAdql(base)).toContain("source_id || '' AS source_id");
  });

  it('caps rows with TOP and has NO ORDER BY (the client ranks by real separation)', () => {
    const adql = buildGaiaDistanceConeAdql({ ...base, maxRows: 12 });
    expect(adql).toContain('SELECT TOP 12');
    expect(adql).not.toMatch(/ORDER\s+BY/i);
  });

  it('rejects non-finite coordinates and non-positive radius', () => {
    expect(() => buildGaiaDistanceConeAdql({ ...base, ra: NaN })).toThrow(/Invalid ra/);
    expect(() => buildGaiaDistanceConeAdql({ ...base, dec: Infinity })).toThrow(/Invalid dec/);
    expect(() => buildGaiaDistanceConeAdql({ ...base, radiusDeg: 0 })).toThrow(/radiusDeg/);
    expect(() => buildGaiaDistanceConeAdql({ ...base, radiusDeg: -1 })).toThrow(/radiusDeg/);
  });
});

/* -------------------------------------------------------------------------- */
/* parseGaiaDistances                                                         */
/* -------------------------------------------------------------------------- */

const COLS = [
  { name: 'source_id', datatype: 'char' },
  { name: 'ra', datatype: 'double' },
  { name: 'dec', datatype: 'double' },
  { name: 'phot_g_mean_mag', datatype: 'float' },
  { name: 'r_med_geo', datatype: 'float' },
  { name: 'r_lo_geo', datatype: 'float' },
  { name: 'r_hi_geo', datatype: 'float' },
  { name: 'r_med_photogeo', datatype: 'float' },
  { name: 'r_lo_photogeo', datatype: 'float' },
  { name: 'r_hi_photogeo', datatype: 'float' },
];

describe('parseGaiaDistances', () => {
  it('maps GAVO columns/data to typed rows, keeping the asymmetric lo/hi interval', () => {
    const raw = {
      columns: COLS,
      data: [['123', 101.5, -16.7, 15.2, 500, 450, 560, 505, 452, 558]],
    };
    const [r] = parseGaiaDistances(raw);
    expect(r!.sourceId).toBe('123');
    expect(r!.ra).toBeCloseTo(101.5, 6);
    expect(r!.dec).toBeCloseTo(-16.7, 6);
    expect(r!.gMag).toBeCloseTo(15.2, 6);
    expect(r!.distGeoPc).toEqual({ med: 500, lo: 450, hi: 560 });
    expect(r!.distPhotoGeoPc).toEqual({ med: 505, lo: 452, hi: 558 });
    // The interval is asymmetric — do NOT assume med-lo === hi-med.
    expect(r!.distGeoPc.med - r!.distGeoPc.lo).not.toBe(r!.distGeoPc.hi - r!.distGeoPc.med);
  });

  it('maps a null photogeometric distance to NaN (never 0)', () => {
    const raw = {
      columns: COLS,
      data: [['1', 10, 20, 14, 500, 450, 560, null, null, null]],
    };
    const [r] = parseGaiaDistances(raw);
    expect(r!.distGeoPc.med).toBe(500);
    expect(Number.isNaN(r!.distPhotoGeoPc.med)).toBe(true);
    expect(Number.isNaN(r!.distPhotoGeoPc.lo)).toBe(true);
    expect(r!.distPhotoGeoPc.med).not.toBe(0);
  });

  it('normalises RA into [0,360)', () => {
    const raw = { columns: COLS, data: [['1', -1, 20, 14, 1, 1, 1, 1, 1, 1]] };
    expect(parseGaiaDistances(raw)[0]!.ra).toBeCloseTo(359, 6);
  });

  it('preserves a 19-digit source_id exactly (no precision loss)', () => {
    const id = '2947051394244540672';
    const raw = { columns: COLS, data: [[id, 10, 20, 14, 1, 1, 1, 1, 1, 1]] };
    expect(parseGaiaDistances(raw)[0]!.sourceId).toBe(id);
  });

  it('accepts the ESA `metadata` descriptor key as well as GAVO `columns`', () => {
    const raw = { metadata: COLS, data: [['9', 5, 6, 12, 100, 90, 110, 100, 90, 110]] };
    expect(parseGaiaDistances(raw)[0]!.sourceId).toBe('9');
  });

  it('returns [] for a valid empty result (not a throw)', () => {
    expect(parseGaiaDistances({ columns: COLS, data: [] })).toEqual([]);
  });

  it('throws on a non-object body, missing descriptors, or absent ra/dec', () => {
    expect(() => parseGaiaDistances(null)).toThrow(/expected a Gaia TAP JSON object/);
    expect(() => parseGaiaDistances({ data: [] })).toThrow(/column descriptors/);
    const noPos = [{ name: 'source_id' }, { name: 'r_med_geo' }];
    expect(() => parseGaiaDistances({ columns: noPos, data: [] })).toThrow(/`ra`\/`dec`/);
  });
});

/* -------------------------------------------------------------------------- */
/* fetchNearestGaiaDistance (fetch mocked)                                    */
/* -------------------------------------------------------------------------- */

function mockJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('fetchNearestGaiaDistance', () => {
  afterEach(() => vi.restoreAllMocks());

  it('picks the source with the SMALLEST angular separation, not the first row', async () => {
    // Query at (101.287, -16.716). Row 1 is nearer than row 0; a "return first row"
    // (or a "trust server order") bug would return the FARTHER 999-id source.
    const body = {
      columns: COLS,
      data: [
        ['999', 101.4, -16.716, 15, 1000, 900, 1100, 1010, 905, 1120], // ~0.113 deg away
        ['111', 101.29, -16.716, 12, 300, 290, 310, 305, 291, 320], // ~0.003 deg away
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(body));
    globalThis.fetch = fetchMock;

    const near = await fetchNearestGaiaDistance({ ra: 101.287, dec: -16.716, radiusArcsec: 600 });
    expect(near).not.toBeNull();
    expect(near!.sourceId).toBe('111');
    expect(near!.distPhotoGeoPc.med).toBe(305);
    expect(near!.distGeoPc.med).toBe(300);
    // Separation reported in ARCSECONDS and matches the ~0.003 deg offset.
    expect(near!.separationArcsec).toBeCloseTo(0.003 * 3600, 0);
    // Radius arcsec→deg conversion reached the ADQL (600" = 1/6 deg).
    const sentBody = String(fetchMock.mock.calls[0]![1]!.body);
    expect(decodeURIComponent(sentBody)).toContain(String(600 / 3600));
  });

  it('returns null for an empty cone (a legitimate answer, not an error)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({ columns: COLS, data: [] }));
    const near = await fetchNearestGaiaDistance({ ra: 5, dec: 5, radiusArcsec: 10 });
    expect(near).toBeNull();
  });

  it('throws a descriptive error on a network/CORS failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      fetchNearestGaiaDistance({ ra: 5, dec: 5, radiusArcsec: 10 })
    ).rejects.toThrow(/network or CORS/);
  });

  it('throws with the status code on a non-2xx response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    } as unknown as Response);
    await expect(
      fetchNearestGaiaDistance({ ra: 5, dec: 5, radiusArcsec: 10 })
    ).rejects.toThrow(/failed \(500\)/);
  });

  it('rejects non-positive radius before any fetch', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(
      fetchNearestGaiaDistance({ ra: 5, dec: 5, radiusArcsec: 0 })
    ).rejects.toThrow(/radiusArcsec/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
