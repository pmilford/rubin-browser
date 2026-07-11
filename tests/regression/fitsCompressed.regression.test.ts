import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readFitsImageAsync } from '../../src/utils/fitsCompressed.js';

/**
 * REAL-DATA regression for the tile-compressed FITS reader. The fixture is a
 * VERBATIM DP1 SODA cutout captured live (GET /api/cutout/sync of an
 * ivoa.ObsCore lsst.deep_coadd at the EDFS field, 2026-07). It is a multi-
 * extension FITS: primary NAXIS=0, image in a GZIP_2 tile-compressed BINTABLE
 * extension named IMAGE — the exact structure the old plain-primary readFits
 * choked on ("NAXIS=0"), which broke every live DP1 cutout / RGB composite.
 */
const buf = readFileSync('tests/fixtures/dp1-deep-coadd-cutout.fits');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

describe('tile-compressed FITS (DP1 SODA cutout) — real-response regression', () => {
  it('decodes the GZIP_2 tile-compressed image to a finite 152×152 float array', async () => {
    const img = await readFitsImageAsync(ab as ArrayBuffer);
    expect(img.width).toBe(152);
    expect(img.height).toBe(152);
    expect(img.data.length).toBe(152 * 152);

    let finite = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const v of img.data) {
      if (Number.isFinite(v)) {
        finite++;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    // Every pixel is a finite float (GZIP_2 unshuffle + big-endian decode correct).
    expect(finite).toBe(152 * 152);
    // The captured cutout's real dynamic range (nJy), pinned to catch a mis-decode.
    expect(min).toBeCloseTo(-24.8768, 2);
    expect(max).toBeCloseTo(272.3041, 2);
  });

  it('carries the TAN WCS + BUNIT from the compressed extension header', async () => {
    const { header } = await readFitsImageAsync(ab as ArrayBuffer);
    expect(header.ctype1).toBe('RA---TAN');
    expect(header.ctype2).toBe('DEC--TAN');
    expect(header.crval1).toBeCloseTo(59.2683, 3);
    expect(header.bunit).toBe('nJy');
  });
});
