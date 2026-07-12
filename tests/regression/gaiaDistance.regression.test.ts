import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGaiaDistances, fetchNearestGaiaDistance } from '../../src/api/gaiaDistance.js';

/**
 * REAL-DATA regression for the Bailer-Jones distance client. The fixture is a
 * VERBATIM, unedited response captured LIVE from the GAVO mirror
 * (https://dc.zah.uni-heidelberg.de/tap/sync, table `gedr3dist.litewithdist`,
 * a 0.03° cone at RA 101.287 Dec -16.716, 2026-07) — the exact service the app
 * queries, with `Access-Control-Allow-Origin` reflecting the app origin. Parsing
 * it with JSON.parse (as the app does) then `parseGaiaDistances` locks in the real
 * wire shape: the GAVO `columns` descriptor key (NOT ESA's `metadata`), `source_id`
 * delivered as a JSON STRING via the `source_id || ''` text cast (so the 64-bit id
 * survives JSON.parse), the parsec distance columns, and null-as-NaN.
 *
 * Regenerate with:
 *   curl -s -X POST https://dc.zah.uni-heidelberg.de/tap/sync \
 *     -H 'Origin: http://localhost:5173' \
 *     --data-urlencode REQUEST=doQuery --data-urlencode LANG=ADQL \
 *     --data-urlencode FORMAT=json \
 *     --data-urlencode "QUERY=SELECT TOP 6 source_id || '' AS source_id, ra, dec, phot_g_mean_mag, r_med_geo, r_lo_geo, r_hi_geo, r_med_photogeo, r_lo_photogeo, r_hi_photogeo FROM gedr3dist.litewithdist WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', 101.287, -16.716, 0.03)) = 1"
 */
const raw = JSON.parse(readFileSync('tests/fixtures/gaia-gedr3dist-cone.json', 'utf-8'));

describe('Gaia gedr3dist.litewithdist — real-response regression', () => {
  it('exposes the GAVO wire shape (columns key, source_id as char/text), not ESA metadata', () => {
    expect(Array.isArray(raw.columns)).toBe(true);
    expect(raw.metadata).toBeUndefined();
    const names = raw.columns.map((c: { name: string }) => c.name);
    for (const col of [
      'source_id',
      'ra',
      'dec',
      'phot_g_mean_mag',
      'r_med_geo',
      'r_med_photogeo',
      'r_lo_photogeo',
      'r_hi_photogeo',
    ]) {
      expect(names).toContain(col);
    }
    const idCol = raw.columns.find((c: { name: string }) => c.name === 'source_id');
    expect(idCol.datatype).toBe('char'); // the text cast, so the id is a JSON string
    const distCol = raw.columns.find((c: { name: string }) => c.name === 'r_med_geo');
    expect(distCol.unit).toBe('pc'); // distances are in PARSECS on the wire
  });

  it('parses every row to finite distances and preserves the exact 64-bit source_id', () => {
    const rows = parseGaiaDistances(raw);
    expect(rows.length).toBe(6);
    for (const r of rows) {
      // source_id is the exact 19-digit string straight off the wire.
      expect(r.sourceId).toMatch(/^\d{19}$/);
      expect(Number.isFinite(r.ra)).toBe(true);
      expect(Number.isFinite(r.dec)).toBe(true);
      // Both geometric bounds are finite and ordered lo <= med <= hi (a real
      // posterior interval, never all-zero).
      expect(Number.isFinite(r.distGeoPc.med)).toBe(true);
      expect(r.distGeoPc.med).toBeGreaterThan(0);
      expect(r.distGeoPc.lo).toBeLessThanOrEqual(r.distGeoPc.med);
      expect(r.distGeoPc.med).toBeLessThanOrEqual(r.distGeoPc.hi);
    }
    // The wire cell for source_id is a STRING (proves the text cast survived
    // JSON.parse) — a bare number would already have lost its low digits.
    expect(typeof raw.data[0][0]).toBe('string');
  });

  it('parses the exact captured values for a specific source', () => {
    const rows = parseGaiaDistances(raw);
    const r = rows.find((x) => x.sourceId === '2947051394244540672');
    expect(r).toBeDefined();
    // Verbatim from the fixture: this source's photogeometric median distance.
    expect(r!.distGeoPc.med).toBeCloseTo(5343.169, 2);
    expect(r!.distPhotoGeoPc.med).toBeCloseTo(11018.109, 2);
    expect(r!.gMag).toBeCloseTo(16.88052, 4);
  });

  it('fetchNearestGaiaDistance (fixture-backed) picks the smallest-separation source of many', async () => {
    afterEach(() => vi.restoreAllMocks());
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(raw),
      text: () => Promise.resolve(''),
    } as unknown as Response);

    // Query at the cone centre. Of the 6 real sources, the nearest (computed by
    // great-circle separation over the REAL positions) is 2947051394244540672
    // at ~91.4". A "return first row" bug would wrongly return 2947051424299734144.
    const near = await fetchNearestGaiaDistance({ ra: 101.287, dec: -16.716, radiusArcsec: 120 });
    expect(near).not.toBeNull();
    expect(near!.sourceId).toBe('2947051394244540672');
    expect(near!.separationArcsec).toBeCloseTo(91.4, 0);
    expect(near!.distPhotoGeoPc.med).toBeCloseTo(11018.109, 2);
    expect(near!.sourceId).not.toBe(raw.data[0][0]); // NOT merely the first row
  });
});

/**
 * ADVERSARIAL: a broken parser that ignores the column names (reads fixed positions
 * / returns the raw rows) must FAIL these assertions — proving the real parser's
 * by-name column mapping is load-bearing, not decorative.
 */
describe('adversarial — a no-op / wrong-column parser cannot pass', () => {
  it('a positional parser that misreads distance columns produces wrong values', () => {
    // Simulate the bug: read r_med_geo from the WRONG index (dec's column, idx 2).
    const badParse = (r: typeof raw) =>
      r.data.map((row: unknown[]) => ({ medGeo: row[2] as number }));
    const bad = badParse(raw);
    const good = parseGaiaDistances(raw);
    // The wrong-column value is a declination (~ -16.7), which is NOT the real
    // distance (~thousands of pc) — so a wrong-column parser is detectably broken.
    expect(bad[0]!.medGeo).not.toBeCloseTo(good[0]!.distGeoPc.med, 0);
    expect(Math.abs(bad[0]!.medGeo)).toBeLessThan(100); // it's a dec, not a distance
    expect(good[0]!.distGeoPc.med).toBeGreaterThan(100);
  });

  it('a no-op parser that returns [] fails the non-empty real fixture', () => {
    const noop = (): unknown[] => [];
    expect(noop().length).toBe(0);
    // The REAL parser must surface all 6 captured sources.
    expect(parseGaiaDistances(raw).length).toBe(6);
  });
});
