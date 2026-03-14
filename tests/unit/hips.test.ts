import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchHipsProperties,
  buildTileUrl,
  fetchTile,
  radecToTileIndex,
  orderToNside,
  radecToHealpixNest,
} from '../../src/api/hips.js';

// Mock auth module
vi.mock('../../src/api/auth.js', () => ({
  getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
}));

const SAMPLE_PROPERTIES = `
# HiPS properties
obs_title = Rubin DP1 gri Color
hips_order = 11
hips_tile_format = png jpg
hips_frame = equatorial
hips_tile_width = 512
creator_did = ivo://rubin/dp1
`.trim();

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchHipsProperties', () => {
  it('parses properties response correctly', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_PROPERTIES),
    });

    const props = await fetchHipsProperties();

    expect(props).toEqual({
      title: 'Rubin DP1 gri Color',
      hipsOrder: 11,
      tileFormat: 'png jpg',
      frame: 'equatorial',
      tileWidth: 512,
    });
  });

  it('uses default survey path', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_PROPERTIES),
    });

    await fetchHipsProperties();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://data.lsst.cloud/api/hips/images/color_gri/properties',
      { headers: { Authorization: 'Bearer test-token' } }
    );
  });

  it('uses custom survey path', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_PROPERTIES),
    });

    await fetchHipsProperties('images/band_r');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://data.lsst.cloud/api/hips/images/band_r/properties',
      expect.any(Object)
    );
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    });

    await expect(fetchHipsProperties()).rejects.toThrow(
      'HiPS properties fetch failed (404): Not found'
    );
  });

  it('handles missing properties with defaults', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# empty\n'),
    });

    const props = await fetchHipsProperties();

    expect(props).toEqual({
      title: '',
      hipsOrder: 3,
      tileFormat: 'png',
      frame: 'equatorial',
      tileWidth: 512,
    });
  });

  it('falls back to creator_did for title', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('creator_did = ivo://rubin/test'),
    });

    const props = await fetchHipsProperties();
    expect(props.title).toBe('ivo://rubin/test');
  });

  it('skips malformed lines without equals sign', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('obs_title = Test\nno_equals_here\nhips_order = 5'),
    });

    const props = await fetchHipsProperties();
    expect(props.title).toBe('Test');
    expect(props.hipsOrder).toBe(5);
  });
});

describe('buildTileUrl', () => {
  it('builds correct URL with defaults', () => {
    const url = buildTileUrl(3, 42);
    expect(url).toBe(
      'https://data.lsst.cloud/api/hips/images/color_gri/Norder3/Dir0/Npix42.png'
    );
  });

  it('calculates Dir from pixelIndex', () => {
    const url = buildTileUrl(5, 25003);
    expect(url).toContain('/Dir20000/');
  });

  it('uses Dir0 for small pixel indices', () => {
    const url = buildTileUrl(3, 9999);
    expect(url).toContain('/Dir0/');
  });

  it('uses jpg format', () => {
    const url = buildTileUrl(3, 0, 'jpg');
    expect(url).toMatch(/\.jpg$/);
  });

  it('uses fits format', () => {
    const url = buildTileUrl(3, 0, 'fits');
    expect(url).toMatch(/\.fits$/);
  });

  it('uses custom survey path', () => {
    const url = buildTileUrl(3, 0, 'png', 'images/band_u');
    expect(url).toContain('/images/band_u/');
  });

  it('handles large pixel indices', () => {
    const url = buildTileUrl(11, 35000);
    expect(url).toBe(
      'https://data.lsst.cloud/api/hips/images/color_gri/Norder11/Dir30000/Npix35000.png'
    );
  });
});

describe('fetchTile', () => {
  it('fetches tile and returns blob', async () => {
    const mockBlob = new Blob(['fake-image'], { type: 'image/png' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    const blob = await fetchTile(3, 42);

    expect(blob).toBe(mockBlob);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://data.lsst.cloud/api/hips/images/color_gri/Norder3/Dir0/Npix42.png',
      { headers: { Authorization: 'Bearer test-token' } }
    );
  });

  it('passes format and survey path through', async () => {
    const mockBlob = new Blob(['data']);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    await fetchTile(5, 100, 'fits', 'images/band_r');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://data.lsst.cloud/api/hips/images/band_r/Norder5/Dir0/Npix100.fits',
      expect.any(Object)
    );
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal error'),
    });

    await expect(fetchTile(3, 42)).rejects.toThrow(
      'HiPS tile fetch failed (500): Internal error'
    );
  });
});

describe('orderToNside', () => {
  it('returns 1 for order 0', () => {
    expect(orderToNside(0)).toBe(1);
  });

  it('returns 2 for order 1', () => {
    expect(orderToNside(1)).toBe(2);
  });

  it('returns 8 for order 3', () => {
    expect(orderToNside(3)).toBe(8);
  });

  it('returns 2048 for order 11', () => {
    expect(orderToNside(11)).toBe(2048);
  });
});

describe('radecToHealpixNest', () => {
  it('returns index in valid range for nside=1', () => {
    const idx = radecToHealpixNest(0, 0, 1);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12);
  });

  it('returns index in valid range for nside=4', () => {
    const idx = radecToHealpixNest(45, 30, 4);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12 * 16);
  });

  it('returns index in valid range for nside=8', () => {
    const idx = radecToHealpixNest(180, -45, 8);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12 * 64);
  });

  it('handles north pole (dec=90)', () => {
    const idx = radecToHealpixNest(0, 90, 4);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12 * 16);
  });

  it('handles south pole (dec=-90)', () => {
    const idx = radecToHealpixNest(0, -90, 4);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12 * 16);
  });

  it('handles ra=0', () => {
    const idx = radecToHealpixNest(0, 0, 4);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12 * 16);
  });

  it('handles ra=360 (same as ra=0)', () => {
    const idx360 = radecToHealpixNest(360, 0, 4);
    const idx0 = radecToHealpixNest(0, 0, 4);
    expect(idx360).toBe(idx0);
  });

  it('handles negative RA by wrapping', () => {
    const idxNeg = radecToHealpixNest(-90, 0, 4);
    const idxPos = radecToHealpixNest(270, 0, 4);
    expect(idxNeg).toBe(idxPos);
  });

  it('different coordinates produce different pixels at high nside', () => {
    const idx1 = radecToHealpixNest(10, 20, 64);
    const idx2 = radecToHealpixNest(50, -30, 64);
    expect(idx1).not.toBe(idx2);
  });

  it('produces valid range for equatorial belt coordinates', () => {
    // dec=0 is firmly in the equatorial belt (z=0, za=0 < 2/3)
    const idx = radecToHealpixNest(120, 0, 8);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12 * 64);
  });

  it('covers all equatorial face branches', () => {
    // Test a range of equatorial coordinates to hit ifp<ifm, ifp>ifm, ifp===ifm
    const testCoords: [number, number][] = [
      [45, 30], [135, 30], [225, 30], [315, 30],   // positive dec, equatorial
      [45, -30], [135, -30], [225, -30], [315, -30], // negative dec, equatorial
      [0, 10], [90, 10], [180, 10], [270, 10],       // small positive dec
    ];
    for (const [ra, dec] of testCoords) {
      const idx = radecToHealpixNest(ra, dec, 8);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(12 * 64);
    }
  });

  it('produces valid range for polar cap coordinates', () => {
    // dec=80 gives za ~ 0.98 > 2/3, firmly in polar cap
    const idx = radecToHealpixNest(45, 80, 8);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12 * 64);
  });

  it('produces valid range for south polar cap', () => {
    const idx = radecToHealpixNest(200, -80, 8);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12 * 64);
  });

  it('all quadrants produce valid indices', () => {
    const coords = [
      [0, 45], [90, 45], [180, 45], [270, 45],
      [0, -45], [90, -45], [180, -45], [270, -45],
    ];
    for (const [ra, dec] of coords) {
      const idx = radecToHealpixNest(ra, dec, 4);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(12 * 16);
    }
  });
});

describe('radecToTileIndex', () => {
  it('returns valid index for order 3', () => {
    const idx = radecToTileIndex(180, 0, 3);
    const nside = orderToNside(3);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12 * nside * nside);
  });

  it('uses orderToNside internally', () => {
    // order 0 → nside 1 → 12 total pixels
    const idx = radecToTileIndex(45, 30, 0);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12);
  });

  it('higher order produces index in larger range', () => {
    const idx = radecToTileIndex(100, -20, 5);
    const nside = orderToNside(5);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(12 * nside * nside);
  });
});
