import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCutoutUrl,
  fetchCutout,
  SODA_SYNC_URL,
  type CutoutParams,
} from '../../src/api/soda.js';

// Auth lives in auth.ts; mock it so we control sign-in state and the header
// without touching sessionStorage — mirrors how lightcurve.test.ts mocks tap.js.
vi.mock('../../src/api/auth.js', () => ({
  getAuthHeader: vi.fn(),
  isAuthenticated: vi.fn(),
}));
import { getAuthHeader, isAuthenticated } from '../../src/api/auth.js';

/** Decode the POS value out of a built cutout URL. */
function posParam(url: string): string {
  const q = new URL(url).searchParams.get('POS');
  if (q === null) throw new Error(`no POS param in: ${url}`);
  return q;
}

/** Parse the CIRCLE radius (last number of `CIRCLE ra dec radius`) as a number. */
function circleRadius(url: string): number {
  const parts = posParam(url).trim().split(/\s+/);
  // ['CIRCLE', ra, dec, radius]
  return Number(parts[3]);
}

describe('buildCutoutUrl', () => {
  const base: CutoutParams = { ra: 62.0, dec: -37.0, sizeArcsec: 30 };

  it('targets the single SODA_SYNC_URL endpoint', () => {
    expect(buildCutoutUrl(base).startsWith(SODA_SYNC_URL)).toBe(true);
  });

  it('emits POS=CIRCLE with the exact ra/dec centre (ICRS, degrees)', () => {
    // Kills a version that drops or swaps ra/dec.
    expect(posParam(buildCutoutUrl(base))).toBe('CIRCLE 62 -37 0.004166666666666667');
    const parts = posParam(buildCutoutUrl(base)).split(/\s+/);
    expect(parts[0]).toBe('CIRCLE');
    expect(Number(parts[1])).toBe(62);
    expect(Number(parts[2])).toBe(-37);
  });

  it('converts arcsec SIZE to a CIRCLE radius in DEGREES (size/2/3600)', () => {
    // sizeArcsec=30 → radius 15" = 0.0041666.. deg. Kills an arcsec/deg confusion
    // AND a size-used-as-radius (no /2) confusion.
    expect(circleRadius(buildCutoutUrl(base))).toBeCloseTo(30 / 2 / 3600, 12);
    expect(circleRadius(buildCutoutUrl(base))).toBeCloseTo(0.0041666666, 9);
    // A no-conversion bug would leave 30 (or 15) in the CIRCLE.
    expect(circleRadius(buildCutoutUrl(base))).not.toBe(30);
    expect(circleRadius(buildCutoutUrl(base))).not.toBe(15);

    // 7200 arcsec full size ⇒ 3600" radius = exactly 1 degree.
    expect(circleRadius(buildCutoutUrl({ ra: 10, dec: 20, sizeArcsec: 7200 }))).toBeCloseTo(1, 12);
  });

  it('includes the dataset ID when given, omits it otherwise', () => {
    const withId = buildCutoutUrl({ ...base, id: 'butler://dp1/deepCoadd/12345' });
    expect(new URL(withId).searchParams.get('ID')).toBe('butler://dp1/deepCoadd/12345');
    expect(new URL(buildCutoutUrl(base)).searchParams.has('ID')).toBe(false);
  });

  it('formats a tiny radius without scientific notation', () => {
    // 0.001 arcsec full size ⇒ 1.39e-7 deg radius — must not appear as `1.39e-7`.
    const radiusStr = posParam(buildCutoutUrl({ ra: 1, dec: 1, sizeArcsec: 0.001 })).split(/\s+/)[3];
    expect(radiusStr).not.toMatch(/e/i);
  });

  it('rejects non-finite coordinates and non-positive size', () => {
    expect(() => buildCutoutUrl({ ...base, ra: NaN })).toThrow(/Invalid ra/);
    expect(() => buildCutoutUrl({ ...base, dec: Infinity })).toThrow(/Invalid dec/);
    expect(() => buildCutoutUrl({ ...base, sizeArcsec: 0 })).toThrow(/sizeArcsec/);
    expect(() => buildCutoutUrl({ ...base, sizeArcsec: -5 })).toThrow(/sizeArcsec/);
  });
});

describe('fetchCutout', () => {
  const params: CutoutParams = { ra: 53.1, dec: -28.2, sizeArcsec: 20 };

  beforeEach(() => {
    vi.mocked(getAuthHeader).mockReset();
    vi.mocked(isAuthenticated).mockReset();
    // Default: signed in with a bearer token.
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(getAuthHeader).mockReturnValue({ Authorization: 'Bearer test-token' });
  });

  it('sends the Authorization header from getAuthHeader', async () => {
    // Kills a no-auth implementation.
    const bytes = new ArrayBuffer(8);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(bytes),
    });

    await fetchCutout(params);

    expect(fetch).toHaveBeenCalledTimes(1);
    const headers = vi.mocked(fetch).mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
  });

  it('returns the ArrayBuffer bytes unchanged on success', async () => {
    // Kills an impl that reshapes/drops the bytes.
    const bytes = new Uint8Array([0x53, 0x49, 0x4d, 0x50, 0x4c, 0x45]).buffer; // "SIMPLE"
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(bytes),
    });

    const result = await fetchCutout(params);
    expect(result).toBe(bytes);
    expect(new Uint8Array(result)).toEqual(new Uint8Array([0x53, 0x49, 0x4d, 0x50, 0x4c, 0x45]));
  });

  it('does NOT call fetch and throws sign-in error when not authenticated', async () => {
    // Kills "tries anyway then fails confusingly".
    vi.mocked(isAuthenticated).mockReturnValue(false);
    globalThis.fetch = vi.fn();

    await expect(fetchCutout(params)).rejects.toThrow(/require sign-in \(read:image\)/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws a token/rights error on 401 and 403 (distinct from 404/network)', async () => {
    // Kills a silent-catch impl and a one-error-fits-all impl.
    for (const status of [401, 403]) {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status,
        text: () => Promise.resolve('denied'),
      });
      await expect(fetchCutout(params)).rejects.toThrow(/rejected|data rights/i);
    }
  });

  it('throws a "no cutout at this position" error on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('not found'),
    });
    await expect(fetchCutout(params)).rejects.toThrow(/no cutout at this position/i);
    // Distinct from the auth message.
    await expect(fetchCutout(params)).rejects.not.toThrow(/data rights/i);
  });

  it('throws a "could not reach" error when fetch rejects (network/CORS)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchCutout(params)).rejects.toThrow(/could not reach the cutout service/i);
  });

  it('throws an "empty cutout" error when the body has zero bytes', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    await expect(fetchCutout(params)).rejects.toThrow(/empty cutout/i);
  });

  it('surfaces other HTTP errors with the status and body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    });
    await expect(fetchCutout(params)).rejects.toThrow(/500.*boom/);
  });
});
