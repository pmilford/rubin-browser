import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildDiaSourceAdql,
  parseDiaSources,
  fetchDiaAlerts,
  DIA_DEFAULT_ALERT_TYPE,
  type DiaSourceQueryParams,
} from '../../src/api/diaSource.js';
import { fluxToAbMag } from '../../src/api/lightcurve.js';
import { generateSyntheticAlerts, AlertType } from '../../src/data/alerts.js';
import type { AlertSet } from '../../src/data/alerts.js';
import type { TapQueryResult } from '../../src/types/catalog.js';

// query() lives in tap.ts; mock it so fetchDiaAlerts never hits the network.
vi.mock('../../src/api/tap.js', () => ({
  query: vi.fn(),
}));
// isAuthenticated() gates the live source; mock it so we control auth per test.
vi.mock('../../src/api/auth.js', () => ({
  isAuthenticated: vi.fn(),
}));
import { query } from '../../src/api/tap.js';
import { isAuthenticated } from '../../src/api/auth.js';

/** Build a fixture TAP result from row objects (the shape query() returns). */
function tapResult(rows: Record<string, unknown>[]): TapQueryResult {
  return { status: 'completed', rowCount: rows.length, columns: [], rows };
}

/** Extract the three CIRCLE args (ra, dec, radius) from an ADQL string. */
function circleArgs(adql: string): [number, number, number] {
  const m = adql.match(
    /CIRCLE\('ICRS',\s*([-\d.eE]+),\s*([-\d.eE]+),\s*([-\d.eE]+)\)/
  );
  if (!m) throw new Error(`no CIRCLE found in:\n${adql}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

describe('buildDiaSourceAdql', () => {
  const base: DiaSourceQueryParams = { ra: 62.0, dec: -37.0, radiusDeg: 0.05 };

  // Kills a DP0.2-namespace impl and a wrong-table impl.
  it('targets dp1.DiaSource, NOT DP0.2, with no Visit join', () => {
    const adql = buildDiaSourceAdql(base);
    expect(adql).toContain('FROM dp1.DiaSource');
    expect(adql).not.toContain('dp02_dc2');
    expect(adql).not.toContain('dp02');
    // DiaSource carries its own MJD — a Visit join would be wrong.
    expect(adql).not.toContain('JOIN dp1.Visit');
  });

  // Kills a cone that drops/mangles the exact ra/dec/radius the caller asked for.
  it('cone-searches with CONTAINS/POINT/CIRCLE at the EXACT ra/dec/radius (degrees)', () => {
    const adql = buildDiaSourceAdql(base);
    expect(adql).toContain('CONTAINS(');
    expect(adql).toContain("POINT('ICRS', ds.ra, ds.dec)");
    expect(adql).toContain("CIRCLE('ICRS'");
    const [ra, dec, radius] = circleArgs(adql);
    expect(ra).toBe(62.0);
    expect(dec).toBe(-37.0);
    // radiusDeg is already degrees — must NOT be divided/converted.
    expect(radius).toBeCloseTo(0.05, 12);
  });

  // Kills a missing-time-filter impl and one that filters even when unbounded.
  it('emits a time-window predicate ONLY when tMin/tMax are given', () => {
    const none = buildDiaSourceAdql(base);
    expect(none).not.toContain('midpointMjdTai >=');
    expect(none).not.toContain('midpointMjdTai <=');

    const both = buildDiaSourceAdql({ ...base, tMinMjd: 60000, tMaxMjd: 60100 });
    expect(both).toContain('ds.midpointMjdTai >= 60000');
    expect(both).toContain('ds.midpointMjdTai <= 60100');

    // Partial bounds emit exactly the supplied side.
    const lo = buildDiaSourceAdql({ ...base, tMinMjd: 60000 });
    expect(lo).toContain('ds.midpointMjdTai >= 60000');
    expect(lo).not.toContain('midpointMjdTai <=');
  });

  // Kills a filter that ignores the reliability floor / artifact cut, OR one that
  // applies them unconditionally (the default overlay must be able to show all).
  it('emits reliability + artifact predicates ONLY when requested', () => {
    const none = buildDiaSourceAdql(base);
    expect(none).not.toContain('reliability >');
    expect(none).not.toContain('isDipole');

    const rel = buildDiaSourceAdql({ ...base, minReliability: 0.5 });
    expect(rel).toContain('ds.reliability > 0.5');
    expect(rel).not.toContain('isDipole'); // reliability floor without the artifact cut

    const clean = buildDiaSourceAdql({ ...base, minReliability: 0.9, excludeArtifacts: true });
    expect(clean).toContain('ds.reliability > 0.9');
    expect(clean).toContain('ds.isDipole = 0');
    expect(clean).toContain('ds.pixelFlags_saturatedCenter = 0');
    expect(clean).toContain('ds.pixelFlags_injected = 0');

    // The reliability column is selected so a parser could carry it.
    expect(none).toContain('ds.reliability AS reliability');
    expect(() => buildDiaSourceAdql({ ...base, minReliability: NaN })).toThrow(/minReliability/);
  });

  // Kills an uncapped query (which could pull millions of DIA rows).
  it('caps rows via TOP/maxRows', () => {
    expect(buildDiaSourceAdql(base)).toMatch(/SELECT TOP \d+/);
    expect(buildDiaSourceAdql({ ...base, maxRows: 500 })).toContain('SELECT TOP 500');
  });

  it('selects the real DP1 DIA columns (id, ra, dec, mjd, flux) with NO dangerous ORDER BY', () => {
    const adql = buildDiaSourceAdql(base);
    expect(adql).toContain('ds.diaSourceId');
    expect(adql).toContain('ds.midpointMjdTai');
    expect(adql).toContain('ds.psfFlux');
    // Rubin flags ORDER BY + TOP as dangerous; the AlertSet is consumed
    // order-independently (min/max scan + per-index predicates), so no sort is emitted.
    expect(adql).not.toMatch(/ORDER BY/i);
  });

  it('rejects non-finite coordinates and non-positive radius', () => {
    expect(() => buildDiaSourceAdql({ ...base, ra: NaN })).toThrow(/Invalid ra/);
    expect(() => buildDiaSourceAdql({ ...base, dec: Infinity })).toThrow(/Invalid dec/);
    expect(() => buildDiaSourceAdql({ ...base, radiusDeg: 0 })).toThrow(/radiusDeg/);
    expect(() => buildDiaSourceAdql({ ...base, radiusDeg: -1 })).toThrow(/radiusDeg/);
  });
});

describe('parseDiaSources', () => {
  // Kills a wrong-column / wrong-unit mapping: exact ra/dec/time values, and a
  // flux row whose mag must equal lightcurve.ts's fluxToAbMag to the number.
  it('maps a 3-row fixture into an AlertSet with EXACT ra/dec/time/mag and length===count', () => {
    const fluxA = 2500; // nJy
    const fluxB = 800; // nJy
    const raw = tapResult([
      { id: 111, ra: 150.1, dec: -30.2, mjd: 60000.5, mag: 20.5 },
      { id: 222, ra: 150.2, dec: -30.3, mjd: 60001.5, flux: fluxA },
      { id: 333, ra: 150.3, dec: -30.4, mjd: 60002.5, flux: fluxB },
    ]);
    const as = parseDiaSources(raw);

    expect(as.count).toBe(3);
    expect(as.ra.length).toBe(as.count);
    expect(as.dec.length).toBe(as.count);
    expect(as.time.length).toBe(as.count);
    expect(as.mag.length).toBe(as.count);

    expect(Array.from(as.ra)).toEqual([
      Math.fround(150.1),
      Math.fround(150.2),
      Math.fround(150.3),
    ]);
    expect(Array.from(as.dec)).toEqual([
      Math.fround(-30.2),
      Math.fround(-30.3),
      Math.fround(-30.4),
    ]);
    expect(Array.from(as.time)).toEqual([
      Math.fround(60000.5),
      Math.fround(60001.5),
      Math.fround(60002.5),
    ]);

    // Direct mag column passes through.
    expect(as.mag[0]).toBeCloseTo(20.5, 4);
    // Flux rows converted via the SAME nJy→AB formula as lightcurve.ts.
    expect(as.mag[1]).toBeCloseTo(fluxToAbMag(fluxA)!, 4);
    expect(as.mag[2]).toBeCloseTo(fluxToAbMag(fluxB)!, 4);
    // Brighter flux ⇒ smaller mag (sanity on the direction of the conversion).
    expect(as.mag[1]).toBeLessThan(as.mag[2]!);

    // Honest single class + sequential ids (drop-in with the synthetic generator).
    expect(Array.from(as.type)).toEqual([
      DIA_DEFAULT_ALERT_TYPE,
      DIA_DEFAULT_ALERT_TYPE,
      DIA_DEFAULT_ALERT_TYPE,
    ]);
    expect(DIA_DEFAULT_ALERT_TYPE).toBe(AlertType.Unknown);
    expect(Array.from(as.id)).toEqual([0, 1, 2]);
  });

  // Kills an impl that throws (or returns garbage) on an empty field.
  it('returns a VALID empty AlertSet (count 0, zero-length arrays) for no rows', () => {
    const as = parseDiaSources(tapResult([]));
    expect(as.count).toBe(0);
    expect(as.ra.length).toBe(0);
    expect(as.dec.length).toBe(0);
    expect(as.time.length).toBe(0);
    expect(as.mag.length).toBe(0);
    expect(as.id.length).toBe(0);
    expect(as.type.length).toBe(0);
  });

  // Kills an impl that silently writes NaNs when the TAP schema/aliasing is wrong.
  it('throws "unexpected columns" when a row lacks required fields', () => {
    // Missing dec.
    expect(() =>
      parseDiaSources(tapResult([{ ra: 10, mjd: 60000, flux: 100 }]))
    ).toThrow(/unexpected columns/);
    // Missing any brightness (no mag, no flux).
    expect(() =>
      parseDiaSources(tapResult([{ ra: 10, dec: -5, mjd: 60000 }]))
    ).toThrow(/unexpected columns/);
    // Missing MJD.
    expect(() =>
      parseDiaSources(tapResult([{ ra: 10, dec: -5, flux: 100 }]))
    ).toThrow(/unexpected columns/);
  });

  it('keeps a non-positive (faded) difference-flux detection but leaves mag NaN', () => {
    const as = parseDiaSources(
      tapResult([{ ra: 10, dec: -5, mjd: 60000, flux: -40 }])
    );
    expect(as.count).toBe(1);
    expect(Number.isNaN(as.mag[0])).toBe(true);
    // Position/time are still real.
    expect(as.dec[0]).toBeCloseTo(-5, 4);
  });

  it('parses raw un-aliased DP1 column names (midpointMjdTai/psfFlux/coord_ra)', () => {
    const as = parseDiaSources(
      tapResult([
        { coord_ra: 200.0, coord_dec: 12.3, midpointMjdTai: 60050.0, psfFlux: 1000 },
      ])
    );
    expect(as.count).toBe(1);
    expect(as.ra[0]).toBeCloseTo(200.0, 3);
    expect(as.time[0]).toBeCloseTo(60050.0, 3);
    expect(as.mag[0]).toBeCloseTo(fluxToAbMag(1000)!, 4);
  });

  it('normalizes RA into [0,360)', () => {
    const as = parseDiaSources(
      tapResult([{ ra: -10, dec: 0, mjd: 60000, flux: 100 }])
    );
    expect(as.ra[0]).toBeCloseTo(350, 3);
  });

  it('throws on a malformed result', () => {
    expect(() => parseDiaSources({} as TapQueryResult)).toThrow(/rows/);
  });
});

// Kills a shape-drift that would break the renderer/index/hit-test/time-slider.
describe('parseDiaSources shape parity with the synthetic generator', () => {
  it('produces the SAME keys and TypedArray constructors as generateSyntheticAlerts', () => {
    const synthetic: AlertSet = generateSyntheticAlerts(5, 1);
    const parsed = parseDiaSources(
      tapResult([{ ra: 1, dec: 1, mjd: 60000, flux: 100 }])
    );

    // Same set of keys.
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(synthetic).sort());

    // Same array/column constructor per key.
    for (const key of Object.keys(synthetic) as (keyof AlertSet)[]) {
      if (key === 'count') {
        expect(typeof parsed.count).toBe('number');
        continue;
      }
      expect((parsed[key] as ArrayBufferView).constructor.name).toBe(
        (synthetic[key] as ArrayBufferView).constructor.name
      );
    }
  });
});

describe('fetchDiaAlerts', () => {
  const params: DiaSourceQueryParams = { ra: 53.1, dec: -28.2, radiusDeg: 0.03 };

  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(isAuthenticated).mockReset();
  });

  // Kills an impl that leaks a network call (or fake data) to signed-out users.
  it('throws sign-in-required and does NOT touch the network when unauthenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false);
    await expect(fetchDiaAlerts(params)).rejects.toThrow(/[Ss]ign-in required/);
    expect(query).not.toHaveBeenCalled();
  });

  it('queries dp1.DiaSource and returns a parsed AlertSet when authenticated', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(query).mockResolvedValue(
      tapResult([
        { ra: 53.1, dec: -28.2, mjd: 60001, flux: 2000 },
        { ra: 53.2, dec: -28.3, mjd: 60002, flux: 1000 },
      ])
    );
    const as = await fetchDiaAlerts(params);

    const sentAdql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sentAdql).toContain('dp1.DiaSource');
    expect(as.count).toBe(2);
    expect(as.time[0]).toBeCloseTo(60001, 3);
  });

  // Kills a silent-truncation impl: a capped/overflowed field MUST be flagged so
  // the UI never presents an arbitrary subset (no ORDER BY) as the whole field.
  it('flags truncated when the server overflows OR the row count hits the cap', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);

    // (a) Server-side MAXREC overflow → truncated regardless of row count.
    vi.mocked(query).mockResolvedValueOnce({
      status: 'overflow',
      rowCount: 2,
      columns: [],
      rows: [
        { ra: 1, dec: 1, mjd: 60000, flux: 100 },
        { ra: 2, dec: 2, mjd: 60001, flux: 100 },
      ],
    });
    expect((await fetchDiaAlerts({ ...params, maxRows: 10000 })).truncated).toBe(true);

    // (b) ADQL TOP cap hit (rowCount === cap) → truncated even if status says OK.
    vi.mocked(query).mockResolvedValueOnce({
      status: 'completed',
      rowCount: 2,
      columns: [],
      rows: [
        { ra: 1, dec: 1, mjd: 60000, flux: 100 },
        { ra: 2, dec: 2, mjd: 60001, flux: 100 },
      ],
    });
    expect((await fetchDiaAlerts({ ...params, maxRows: 2 })).truncated).toBe(true);

    // (c) A complete result under the cap is NOT flagged.
    vi.mocked(query).mockResolvedValueOnce(
      tapResult([{ ra: 1, dec: 1, mjd: 60000, flux: 100 }])
    );
    expect((await fetchDiaAlerts({ ...params, maxRows: 10000 })).truncated).toBeFalsy();
  });

  // Kills an impl that ignores the epoch window and always pulls the whole field.
  it('pushes the epoch window into the ADQL when tMin/tMax are given', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(query).mockResolvedValue(tapResult([{ ra: 1, dec: 1, mjd: 60050, flux: 100 }]));
    await fetchDiaAlerts({ ...params, tMinMjd: 60040, tMaxMjd: 60060 });
    const sentAdql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sentAdql).toContain('ds.midpointMjdTai >= 60040');
    expect(sentAdql).toContain('ds.midpointMjdTai <= 60060');
  });

  // Empty field is honest data, not an error.
  it('returns a valid empty AlertSet (count 0) on an empty result', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(query).mockResolvedValue(tapResult([]));
    const as = await fetchDiaAlerts(params);
    expect(as.count).toBe(0);
    expect(as.ra.length).toBe(0);
  });

  // Kills an impl that collapses all failures into one indistinct error.
  it('throws DISTINCT messages on 401 vs 404 vs network rejection', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true);

    vi.mocked(query).mockRejectedValueOnce(
      new Error('TAP query failed (401): Unauthorized')
    );
    await expect(fetchDiaAlerts(params)).rejects.toThrow(/Not authorized \(401\)/);

    vi.mocked(query).mockRejectedValueOnce(
      new Error('TAP query failed (404): Not Found')
    );
    await expect(fetchDiaAlerts(params)).rejects.toThrow(/not found \(404\)/);

    vi.mocked(query).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchDiaAlerts(params)).rejects.toThrow(/Network error/);
  });
});
