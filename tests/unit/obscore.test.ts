import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildObsCoreImageQuery,
  parseObsCoreImages,
  extractCutoutId,
  discoverCutoutId,
  OBSCORE_TABLE,
  DP1_OBS_COLLECTION,
  DP1_DEEP_COADD_SUBTYPE,
} from '../../src/api/obscore.js';
import type { TapQueryResult } from '../../src/types/catalog.js';

// query() lives in tap.ts; mock it so discovery never hits the network.
vi.mock('../../src/api/tap.js', () => ({ query: vi.fn() }));
import { query } from '../../src/api/tap.js';

/** Build a fixture TAP result from row objects (the shape query() returns). */
function tapResult(rows: Record<string, unknown>[]): TapQueryResult {
  return { status: 'completed', rowCount: rows.length, columns: [], rows };
}

/** A realistic ObsCore DataLink access_url (the DP1 tutorial shape). */
function datalinkUrl(id: string): string {
  return `https://data.lsst.cloud/api/datalink/links?ID=${encodeURIComponent(id)}`;
}

describe('buildObsCoreImageQuery', () => {
  it('targets ivoa.ObsCore with the DP1 deep-coadd + band + spatial filters', () => {
    const adql = buildObsCoreImageQuery({ ra: 53.13, dec: -28.1, band: 'r' });
    expect(adql).toContain(`FROM ${OBSCORE_TABLE}`);
    expect(adql).toContain(`obs_collection = '${DP1_OBS_COLLECTION}'`);
    expect(adql).toContain(`dataproduct_subtype = '${DP1_DEEP_COADD_SUBTYPE}'`);
    expect(adql).toContain("dataproduct_type = 'image'");
    expect(adql).toContain("lsst_band = 'r'");
    // Footprint containment (not a nearby-centre proxy), with the real coords.
    expect(adql).toContain("CONTAINS(POINT('ICRS', 53.13, -28.1), s_region) = 1");
    // Must actually SELECT the DataLink pointer we need downstream.
    expect(adql).toContain('access_url');
  });

  it('rejects a non-allowlisted band (ADQL injection guard)', () => {
    expect(() => buildObsCoreImageQuery({ ra: 1, dec: 2, band: "r'; DROP" })).toThrow(/Invalid band/);
  });

  it('rejects a non-finite coordinate', () => {
    expect(() => buildObsCoreImageQuery({ ra: NaN, dec: 2, band: 'r' })).toThrow(/Invalid ra/);
    expect(() => buildObsCoreImageQuery({ ra: 1, dec: Infinity, band: 'r' })).toThrow(/Invalid dec/);
  });

  it('rejects a subtype containing a quote', () => {
    expect(() =>
      buildObsCoreImageQuery({ ra: 1, dec: 2, band: 'r', subtype: "x' OR '1'='1" })
    ).toThrow(/must not contain a quote/);
  });
});

describe('extractCutoutId', () => {
  it('extracts the DataLink ID from a real ObsCore access_url', () => {
    // A butler dataset id (URL-encoded) round-trips to the raw value.
    const raw = 'butler://dp1/deepCoadd/5063/24/r/abc-123';
    expect(extractCutoutId(datalinkUrl(raw))).toBe(raw);
  });

  it('extracts an ID from a bare query string (no scheme/host)', () => {
    expect(extractCutoutId('ID=deadbeef')).toBe('deadbeef');
  });

  it('throws (never a placeholder) when the URL carries no ID', () => {
    expect(() => extractCutoutId('https://data.lsst.cloud/api/datalink/links?foo=bar')).toThrow(
      /no ID parameter/
    );
    expect(() => extractCutoutId('')).toThrow(/empty access_url/);
  });
});

describe('parseObsCoreImages', () => {
  it('maps rows and drops any row without an access_url (never fabricates one)', () => {
    const raw = tapResult([
      {
        access_url: datalinkUrl('id-1'),
        access_format: 'application/x-votable+xml;content=datalink',
        dataproduct_subtype: 'lsst.deep_coadd',
        lsst_tract: 5063,
        lsst_patch: 24,
        lsst_band: 'r',
        s_ra: 53.1,
        s_dec: -28.1,
      },
      { lsst_tract: 999 }, // no access_url → dropped
    ]);
    const images = parseObsCoreImages(raw);
    expect(images).toHaveLength(1);
    expect(images[0]!.accessUrl).toBe(datalinkUrl('id-1'));
    expect(images[0]!.tract).toBe(5063);
    expect(images[0]!.band).toBe('r');
    expect(images[0]!.sRa).toBeCloseTo(53.1, 6);
  });
});

describe('discoverCutoutId', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('queries ObsCore and returns the ID of the covering coadd', async () => {
    vi.mocked(query).mockResolvedValue(
      tapResult([{ access_url: datalinkUrl('the-real-id'), s_ra: 53.13, s_dec: -28.1 }])
    );
    const target = await discoverCutoutId({ ra: 53.13, dec: -28.1, band: 'r' });
    expect(target.id).toBe('the-real-id');
    // Sanity: it actually issued an ObsCore query.
    const sentAdql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sentAdql).toContain(OBSCORE_TABLE);
  });

  it('picks the patch whose footprint centre is nearest the requested position', async () => {
    vi.mocked(query).mockResolvedValue(
      tapResult([
        { access_url: datalinkUrl('far'), s_ra: 54.0, s_dec: -28.0 },
        { access_url: datalinkUrl('near'), s_ra: 53.14, s_dec: -28.09 },
      ])
    );
    const target = await discoverCutoutId({ ra: 53.13, dec: -28.1, band: 'r' });
    expect(target.id).toBe('near');
  });

  it('throws honestly when no DP1 image covers the position', async () => {
    vi.mocked(query).mockResolvedValue(tapResult([]));
    await expect(discoverCutoutId({ ra: 10, dec: 10, band: 'g' })).rejects.toThrow(
      /No DP1 .* covers/
    );
  });

  it('wraps a TAP failure with token-rights context', async () => {
    vi.mocked(query).mockRejectedValue(new Error('TAP query failed (401): Unauthorized'));
    await expect(discoverCutoutId({ ra: 53, dec: -28, band: 'r' })).rejects.toThrow(
      /requires an RSP token with DP1 data rights/
    );
  });
});
