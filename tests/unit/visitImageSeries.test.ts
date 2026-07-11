import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildVisitImageSeriesAdql,
  parseVisitImageEpochs,
  fetchVisitImageSeries,
  DP1_VISIT_IMAGE_SUBTYPE,
  DEFAULT_MAX_EPOCHS,
} from '../../src/api/visitImageSeries.js';
import type { TapQueryResult } from '../../src/types/catalog.js';
import type { FitsImage } from '../../src/utils/fits.js';

// Mock the network/decoding collaborators so no unit test hits the wire or gunzips.
vi.mock('../../src/api/tap.js', () => ({ query: vi.fn() }));
vi.mock('../../src/api/soda.js', () => ({ fetchCutout: vi.fn() }));
vi.mock('../../src/api/auth.js', () => ({ isAuthenticated: vi.fn() }));
vi.mock('../../src/utils/fitsCompressed.js', () => ({ readFitsImageAsync: vi.fn() }));

import { query } from '../../src/api/tap.js';
import { fetchCutout } from '../../src/api/soda.js';
import { isAuthenticated } from '../../src/api/auth.js';
import { readFitsImageAsync } from '../../src/utils/fitsCompressed.js';

/** Build a fixture TAP result from row objects (the shape query() returns). */
function tapResult(
  rows: Record<string, unknown>[],
  status: 'completed' | 'overflow' = 'completed'
): TapQueryResult {
  return { status, rowCount: rows.length, columns: [], rows };
}

/** A DataLink access_url carrying a dataset ID — the real ObsCore shape. */
function accessUrl(id: string): string {
  return `https://data.lsst.cloud/api/datalink/links?ID=${id}`;
}

/** One ObsCore visit-image row keyed by the real column names. */
function visitRow(id: string, tMin: number, band = 'r'): Record<string, unknown> {
  return {
    access_url: accessUrl(id),
    dataproduct_subtype: DP1_VISIT_IMAGE_SUBTYPE,
    t_min: tMin,
    lsst_band: band,
    s_ra: 59.27,
    s_dec: -48.79,
  };
}

/** A tiny stand-in decoded image (the real decode path is proven in the regression test). */
function fakeImage(): FitsImage {
  return {
    header: { simple: true, bitpix: -32, naxis: 2, naxis1: 2, naxis2: 2, bscale: 1, bzero: 0, cards: {} },
    width: 2,
    height: 2,
    data: new Float64Array([1, 2, 3, 4]),
  };
}

/** Extract the (ra, dec) from the CONTAINS(POINT('ICRS', ra, dec) …) clause. */
function pointArgs(adql: string): [number, number] {
  const m = adql.match(/POINT\('ICRS',\s*([-\d.eE]+),\s*([-\d.eE]+)\)/);
  if (!m) throw new Error(`no POINT found in:\n${adql}`);
  return [Number(m[1]), Number(m[2])];
}

describe('buildVisitImageSeriesAdql', () => {
  const base = { ra: 59.27, dec: -48.79 };

  it('targets ivoa.ObsCore for lsst.visit_image (DP1) — NOT a coadd, NOT DP0.2', () => {
    const adql = buildVisitImageSeriesAdql(base);
    expect(adql).toContain('FROM ivoa.ObsCore');
    expect(adql).toContain("dataproduct_subtype = 'lsst.visit_image'");
    expect(adql).toContain("obs_collection = 'LSST.DP1'");
    // A deep_coadd is single-epoch — the wrong product for a blink.
    expect(adql).not.toContain('lsst.deep_coadd');
    expect(adql).not.toContain('dp02');
  });

  it('cone/CONTAINS-searches at the EXACT ra/dec against s_region', () => {
    const adql = buildVisitImageSeriesAdql(base);
    expect(adql).toContain('CONTAINS(');
    expect(adql).toContain('s_region');
    const [ra, dec] = pointArgs(adql);
    expect(ra).toBe(59.27);
    expect(dec).toBe(-48.79);
  });

  it('selects the epoch (t_min), band, and access_url columns', () => {
    const adql = buildVisitImageSeriesAdql(base);
    expect(adql).toContain('access_url');
    expect(adql).toContain('t_min');
    expect(adql).toContain('lsst_band');
  });

  it('caps rows with TOP and emits NO dangerous ORDER BY', () => {
    const adql = buildVisitImageSeriesAdql(base);
    expect(adql).toMatch(/SELECT TOP \d+/);
    expect(adql).not.toMatch(/ORDER BY/i);
    expect(buildVisitImageSeriesAdql({ ...base, maxEpochs: 7 })).toContain('SELECT TOP 7');
  });

  it('rejects non-finite coordinates', () => {
    expect(() => buildVisitImageSeriesAdql({ ...base, ra: NaN })).toThrow(/Invalid ra/);
    expect(() => buildVisitImageSeriesAdql({ ...base, dec: Infinity })).toThrow(/Invalid dec/);
  });
});

describe('parseVisitImageEpochs', () => {
  it('maps rows to epochs SORTED ASCENDING by t_min, keeping ids as strings', () => {
    const raw = tapResult([
      visitRow('img-c', 60002.5, 'i'),
      visitRow('img-a', 60000.5, 'g'),
      visitRow('img-b', 60001.5, 'r'),
    ]);
    const epochs = parseVisitImageEpochs(raw);
    expect(epochs.map((e) => e.mjd)).toEqual([60000.5, 60001.5, 60002.5]);
    // Sorted, so the ids follow the ascending-time order, not the input order.
    expect(epochs.map((e) => e.id)).toEqual(['img-a', 'img-b', 'img-c']);
    expect(epochs.map((e) => e.band)).toEqual(['g', 'r', 'i']);
    // The id is a STRING (64-bit-safe), extracted from the access_url.
    expect(typeof epochs[0]!.id).toBe('string');
    expect(epochs[0]!.accessUrl).toContain('ID=img-a');
    expect(epochs[0]!.ra).toBeCloseTo(59.27, 5);
  });

  it('preserves a 64-bit decimal id as a string (no float truncation)', () => {
    const big = '9007199254740993'; // 2^53 + 1 — unrepresentable as a JS number
    const epochs = parseVisitImageEpochs(tapResult([visitRow(big, 60000)]));
    expect(epochs[0]!.id).toBe(big);
  });

  it('drops rows missing an access_url, a resolvable ID, or t_min — never fabricates', () => {
    const epochs = parseVisitImageEpochs(
      tapResult([
        visitRow('good', 60000), // kept
        { t_min: 60001, lsst_band: 'r' }, // no access_url → drop
        { access_url: 'https://x/links?FOO=1', t_min: 60002 }, // no ID param → drop
        { access_url: accessUrl('notime'), lsst_band: 'g' }, // no t_min → drop
      ])
    );
    expect(epochs).toHaveLength(1);
    expect(epochs[0]!.id).toBe('good');
  });

  it('returns a VALID empty array for no rows (a position with no visit-images is real)', () => {
    expect(parseVisitImageEpochs(tapResult([]))).toEqual([]);
  });

  it('throws on a malformed result (wrong shape)', () => {
    expect(() => parseVisitImageEpochs({} as TapQueryResult)).toThrow(/rows/);
  });
});

describe('fetchVisitImageSeries', () => {
  const params = { ra: 59.27, dec: -48.79 };

  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(fetchCutout).mockReset();
    vi.mocked(isAuthenticated).mockReset();
    vi.mocked(readFitsImageAsync).mockReset();
    // Default happy-path decode: any bytes → a small finite image.
    vi.mocked(fetchCutout).mockResolvedValue(new ArrayBuffer(8));
    vi.mocked(readFitsImageAsync).mockResolvedValue(fakeImage());
  });

  it('throws sign-in-required and does NOT touch the network when unauthenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false);
    await expect(fetchVisitImageSeries(params)).rejects.toThrow(/[Ss]ign-in required/);
    expect(query).not.toHaveBeenCalled();
    expect(fetchCutout).not.toHaveBeenCalled();
  });

  it('queries ivoa.ObsCore for lsst.visit_image when authenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(query).mockResolvedValue(tapResult([visitRow('a', 60000), visitRow('b', 60001)]));
    const series = await fetchVisitImageSeries(params);
    const sentAdql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sentAdql).toContain('ivoa.ObsCore');
    expect(sentAdql).toContain('lsst.visit_image');
    expect(series.epochs).toHaveLength(2);
    expect(series.totalEpochs).toBe(2);
    expect(series.truncated).toBe(false);
    // Each frame carries its decoded image + epoch metadata, ascending by MJD.
    expect(series.epochs[0]!.mjd).toBe(60000);
    expect(series.epochs[0]!.image.width).toBe(2);
  });

  it('CAPS at maxEpochs and reports truncated + the true totalEpochs (kills a silent cap)', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    // 20 epochs discovered; ask for 12.
    const rows = Array.from({ length: 20 }, (_, i) => visitRow(`img-${i}`, 60000 + i));
    vi.mocked(query).mockResolvedValue(tapResult(rows));

    const series = await fetchVisitImageSeries({ ...params, maxEpochs: 12 });
    expect(series.epochs).toHaveLength(12);
    expect(series.truncated).toBe(true);
    expect(series.totalEpochs).toBe(20);
    // Only the capped epochs were actually fetched as cutouts (quota-safe).
    expect(fetchCutout).toHaveBeenCalledTimes(12);
    // The 12 kept are the EARLIEST by MJD (ascending sort, then cap).
    expect(series.epochs[0]!.mjd).toBe(60000);
    expect(series.epochs[11]!.mjd).toBe(60011);
  });

  it('uses the default cap of 12 when maxEpochs is unspecified', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    const rows = Array.from({ length: 15 }, (_, i) => visitRow(`img-${i}`, 60000 + i));
    vi.mocked(query).mockResolvedValue(tapResult(rows));
    const series = await fetchVisitImageSeries(params);
    expect(series.epochs).toHaveLength(DEFAULT_MAX_EPOCHS);
    expect(series.totalEpochs).toBe(15);
    expect(series.truncated).toBe(true);
  });

  it('flags truncated on a server MAXREC overflow even under the cap', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(query).mockResolvedValue(
      tapResult([visitRow('a', 60000), visitRow('b', 60001)], 'overflow')
    );
    const series = await fetchVisitImageSeries({ ...params, maxEpochs: 12 });
    expect(series.truncated).toBe(true);
  });

  it('SKIPS a per-epoch cutout failure but still returns the other frames', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(query).mockResolvedValue(
      tapResult([visitRow('a', 60000), visitRow('b', 60001), visitRow('c', 60002)])
    );
    // The MIDDLE epoch's cutout rejects (a 404 gap); the others succeed.
    vi.mocked(fetchCutout)
      .mockResolvedValueOnce(new ArrayBuffer(8))
      .mockRejectedValueOnce(new Error('No cutout at this position (404)'))
      .mockResolvedValueOnce(new ArrayBuffer(8));

    const series = await fetchVisitImageSeries(params);
    expect(series.epochs).toHaveLength(2);
    expect(series.failedEpochs).toBe(1);
    // The surviving frames are the first + third epochs (the ones that decoded).
    expect(series.epochs.map((e) => e.mjd)).toEqual([60000, 60002]);
  });

  it('converts the radiusArcsec to a full SODA size (diameter) at the boundary', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(query).mockResolvedValue(tapResult([visitRow('a', 60000)]));
    await fetchVisitImageSeries({ ...params, radiusArcsec: 8 });
    // sizeArcsec passed to SODA must be the DIAMETER = 2 * radius.
    expect(vi.mocked(fetchCutout).mock.calls[0]![0].sizeArcsec).toBe(16);
    expect(vi.mocked(fetchCutout).mock.calls[0]![0].id).toBe('a');
  });

  it('returns a VALID empty series (not a throw) for a field with no epochs', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(query).mockResolvedValue(tapResult([]));
    const series = await fetchVisitImageSeries(params);
    expect(series).toEqual({ epochs: [], truncated: false, totalEpochs: 0, failedEpochs: 0 });
    expect(fetchCutout).not.toHaveBeenCalled();
  });

  it('throws DISTINCT messages on 401 vs 404 vs network rejection of the ObsCore query', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);

    vi.mocked(query).mockRejectedValueOnce(new Error('TAP query failed (401): Unauthorized'));
    await expect(fetchVisitImageSeries(params)).rejects.toThrow(/Not authorized \(401\)/);

    vi.mocked(query).mockRejectedValueOnce(new Error('TAP query failed (404): Not Found'));
    await expect(fetchVisitImageSeries(params)).rejects.toThrow(/not found \(404\)/);

    vi.mocked(query).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchVisitImageSeries(params)).rejects.toThrow(/Network error/);
  });
});
