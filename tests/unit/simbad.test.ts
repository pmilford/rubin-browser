import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildConeAdql,
  buildResolveAdql,
  parseSimbadResponse,
  objectsNear,
  resolveName,
  SIMBAD_TAP_SYNC_URL,
  type SimbadConeParams,
} from '../../src/api/simbad.js';

/** Decode a form-encoded request body (spaces are `+`, not %20, in x-www-form-urlencoded). */
function decodeBody(body: unknown): string {
  return decodeURIComponent(String(body).replace(/\+/g, ' '));
}

/** Extract the three CIRCLE args (ra, dec, radius) from an ADQL string. */
function circleArgs(adql: string): [number, number, number] {
  const m = adql.match(/CIRCLE\('ICRS',\s*([-\d.eE]+),\s*([-\d.eE]+),\s*([-\d.eE]+)\)/);
  if (!m) throw new Error(`no CIRCLE found in:\n${adql}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Build a SIMBAD-shaped TAP JSON result from a column-name list and rows-as-arrays.
 * Mirrors the real `{ metadata:[{name}], data:[[...]] }` shape.
 */
function simbadJson(names: string[], rows: unknown[][]): unknown {
  return {
    metadata: names.map((name) => ({ name, datatype: 'char' })),
    data: rows,
  };
}

describe('buildConeAdql', () => {
  const base: SimbadConeParams = { ra: 10.68, dec: 41.27, radiusArcsec: 60 };

  it('targets the basic table alone (robust — no flux joins)', () => {
    const adql = buildConeAdql(base);
    expect(adql).toContain('FROM basic');
    expect(adql).not.toContain('allfluxes');
    expect(adql).not.toContain('dp1.');
  });

  // Kills a cone that drops/mangles ra/dec, or forgets to convert arcsec → degrees.
  it('cone-searches with CONTAINS/POINT/CIRCLE, radius CONVERTED to degrees', () => {
    const adql = buildConeAdql(base);
    expect(adql).toContain('CONTAINS(');
    expect(adql).toContain("POINT('ICRS', ra, dec)");
    expect(adql).toContain("CIRCLE('ICRS'");
    const [ra, dec, radius] = circleArgs(adql);
    expect(ra).toBe(10.68);
    expect(dec).toBe(41.27);
    // 60 arcsec MUST become 60/3600 degrees — not passed through as arcsec.
    expect(radius).toBeCloseTo(60 / 3600, 12);
    expect(radius).not.toBeCloseTo(60, 6);
  });

  it('selects main_id, ra, dec, otype_txt and orders by separation (nearest first)', () => {
    const adql = buildConeAdql(base);
    for (const col of ['main_id', 'ra', 'dec', 'otype_txt']) {
      expect(adql).toContain(col);
    }
    // A computed separation used for nearest-first ordering.
    expect(adql).toContain('DISTANCE(');
    expect(adql).toMatch(/ORDER BY\s+sep/);
    // Excludes un-positioned rows.
    expect(adql).toContain('ra IS NOT NULL');
  });

  // Kills an uncapped query (which could pull a huge cone).
  it('caps rows via TOP with a default of 20', () => {
    expect(buildConeAdql(base)).toContain('SELECT TOP 20');
    expect(buildConeAdql({ ...base, maxRows: 5 })).toContain('SELECT TOP 5');
  });

  it('rejects non-finite coordinates and non-positive radius', () => {
    expect(() => buildConeAdql({ ...base, ra: NaN })).toThrow(/Invalid ra/);
    expect(() => buildConeAdql({ ...base, dec: Infinity })).toThrow(/Invalid dec/);
    expect(() => buildConeAdql({ ...base, radiusArcsec: 0 })).toThrow(/radiusArcsec/);
    expect(() => buildConeAdql({ ...base, radiusArcsec: -1 })).toThrow(/radiusArcsec/);
  });
});

describe('buildResolveAdql', () => {
  it('joins basic to ident and matches the name exactly', () => {
    const adql = buildResolveAdql('M31');
    expect(adql).toContain('FROM basic');
    expect(adql).toContain('JOIN ident');
    expect(adql).toContain('i.oidref = b.oid');
    expect(adql).toContain("i.id = 'M31'");
  });

  // ADVERSARIAL: an apostrophe must NOT break out of the quoted literal.
  it("escapes a single quote by doubling it (Barnard's Star)", () => {
    const adql = buildResolveAdql("Barnard's Star");
    // The apostrophe is doubled, keeping the string literal well-formed.
    expect(adql).toContain("i.id = 'Barnard''s Star'");
    // A naive (unescaped) build would contain a lone-quote break like `'Barnard's`.
    expect(adql).not.toMatch(/'Barnard's Star'/);
  });
});

describe('parseSimbadResponse', () => {
  const cols = ['main_id', 'ra', 'dec', 'otype_txt', 'sep'];

  it('maps a 2-row fixture to objects with EXACT values', () => {
    const raw = simbadJson(cols, [
      ['M  31', 10.68, 41.27, 'Galaxy', 0.0],
      ['NGC  205', 10.09, 41.68, 'Galaxy', 0.5],
    ]);
    const objs = parseSimbadResponse(raw);
    expect(objs.length).toBe(2);
    expect(objs[0]!.mainId).toBe('M  31');
    expect(objs[0]!.ra).toBeCloseTo(10.68, 6);
    expect(objs[0]!.dec).toBeCloseTo(41.27, 6);
    expect(objs[0]!.objectType).toBe('Galaxy');
    // sep (degrees) surfaced as arcsec.
    expect(objs[1]!.separationArcsec).toBeCloseTo(0.5 * 3600, 3);
  });

  // ADVERSARIAL: reorder the metadata array and prove mapping is BY NAME, not index.
  it('maps columns BY NAME even when the metadata order is shuffled', () => {
    // dec first, then otype_txt, then ra, then main_id — deliberately not SELECT order.
    const raw = simbadJson(
      ['dec', 'otype_txt', 'ra', 'main_id'],
      [[41.27, 'Galaxy', 10.68, 'M  31']]
    );
    const objs = parseSimbadResponse(raw);
    // A positional impl would put 41.27 in .ra; a by-name impl puts 10.68 in .ra.
    expect(objs[0]!.ra).toBeCloseTo(10.68, 6);
    expect(objs[0]!.dec).toBeCloseTo(41.27, 6);
    expect(objs[0]!.objectType).toBe('Galaxy');
    expect(objs[0]!.mainId).toBe('M  31');
  });

  it('skips rows with a null/missing ra or dec (un-positioned entries)', () => {
    const raw = simbadJson(cols, [
      ['Good', 10.68, 41.27, 'Star', 0.0],
      ['NoRa', null, 41.0, 'Star', 0.1],
      ['NoDec', 12.0, null, 'Star', 0.2],
    ]);
    const objs = parseSimbadResponse(raw);
    expect(objs.length).toBe(1);
    expect(objs[0]!.mainId).toBe('Good');
  });

  // Empty cone is honest data, not an error.
  it('returns [] for data:[] with valid metadata', () => {
    expect(parseSimbadResponse(simbadJson(cols, []))).toEqual([]);
  });

  // Kills an impl that silently returns [] for a malformed body.
  it('throws on malformed responses (no/empty metadata)', () => {
    expect(() => parseSimbadResponse({ data: [] })).toThrow(/metadata/);
    expect(() => parseSimbadResponse({ metadata: [], data: [] })).toThrow(/metadata/);
    expect(() => parseSimbadResponse(null)).toThrow(/metadata|SIMBAD/);
  });
});

describe('objectsNear', () => {
  const params: SimbadConeParams = { ra: 10.68, dec: 41.27, radiusArcsec: 30 };
  const okJson = simbadJson(
    ['main_id', 'ra', 'dec', 'otype_txt', 'sep'],
    [
      ['M  31', 10.68, 41.27, 'Galaxy', 0.0],
      ['NGC  205', 10.09, 41.68, 'Galaxy', 0.5],
    ]
  );

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs ADQL to the public SIMBAD endpoint and returns a parsed list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(okJson),
    });

    const objs = await objectsNear(params);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(SIMBAD_TAP_SYNC_URL);
    expect(init?.method).toBe('POST');
    const body = String(init?.body);
    expect(body).toContain('LANG=ADQL');
    expect(body).toContain('REQUEST=doQuery');
    expect(decodeBody(body)).toContain('FROM basic');

    expect(objs.length).toBe(2);
    expect(objs[0]!.mainId).toBe('M  31');
    expect(objs[1]!.objectType).toBe('Galaxy');
  });

  // Kills any impl that leaks the Rubin RSP token to the public CDS service.
  it('sends NO Authorization header (SIMBAD is a public service)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(okJson),
    });

    await objectsNear(params);
    const init = vi.mocked(fetch).mock.calls[0]![1];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const keys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(keys).not.toContain('authorization');
  });

  it('throws with the status code on a non-ok response (e.g. 500)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    });
    await expect(objectsNear(params)).rejects.toThrow(/500/);
    await expect(objectsNear(params)).rejects.toThrow(/boom/);
  });

  it('throws a "could not reach" error when fetch rejects (network/CORS)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(objectsNear(params)).rejects.toThrow(/could not reach the SIMBAD TAP/i);
  });

  it('returns [] for an empty cone', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(simbadJson(['main_id', 'ra', 'dec', 'otype_txt', 'sep'], [])),
    });
    expect(await objectsNear(params)).toEqual([]);
  });
});

describe('resolveName', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a query referencing the name and returns the first object', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          simbadJson(['main_id', 'ra', 'dec', 'otype_txt'], [['M  31', 10.68, 41.27, 'Galaxy']])
        ),
    });

    const obj = await resolveName('M31');
    const body = String(vi.mocked(fetch).mock.calls[0]![1]?.body);
    expect(decodeBody(body)).toContain('JOIN ident');
    expect(decodeBody(body)).toContain("i.id = 'M31'");

    expect(obj).not.toBeNull();
    expect(obj!.mainId).toBe('M  31');
    expect(obj!.ra).toBeCloseTo(10.68, 6);
  });

  // ADVERSARIAL: an apostrophe in the name must be doubled in the outgoing ADQL.
  it("escapes an apostrophe in the name (Barnard's Star)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          simbadJson(
            ['main_id', 'ra', 'dec', 'otype_txt'],
            [["NAME Barnard's star", 269.45, 4.69, 'Star']]
          )
        ),
    });

    await resolveName("Barnard's Star");
    const body = String(vi.mocked(fetch).mock.calls[0]![1]?.body);
    // The decoded ADQL doubles the quote so the literal stays well-formed.
    expect(decodeBody(body)).toContain("i.id = 'Barnard''s Star'");
  });

  it('returns null when the name is unknown (empty result)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(simbadJson(['main_id', 'ra', 'dec', 'otype_txt'], [])),
    });
    expect(await resolveName('NoSuchObject')).toBeNull();
  });
});
