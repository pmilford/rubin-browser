import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readFitsImageAsync } from '../../src/utils/fitsCompressed.js';
import { renderCutout } from '../../src/utils/cutoutRender.js';
import { parseVotable } from '../../src/api/votable.js';
import { parseVisitImageEpochs } from '../../src/api/visitImageSeries.js';
import type { TapQueryResult } from '../../src/types/catalog.js';

/**
 * REAL-DATA regression for the visit-image blink's PER-EPOCH decode path.
 *
 * `fetchVisitImageSeries` fetches each epoch's cutout bytes from SODA and decodes
 * them with `readFitsImageAsync` (the tile-compressed reader). The unit tests mock
 * that decode; THIS test drives it on a VERBATIM real DP1 SODA cutout
 * (`tests/fixtures/dp1-deep-coadd-cutout.fits`, a GZIP_2 tile-compressed multi-
 * extension FITS captured live) as a stand-in single epoch frame, proving the
 * frame a blink would render is a real, finite, WCS-bearing image — not a mock.
 */
const buf = readFileSync('tests/fixtures/dp1-deep-coadd-cutout.fits');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

describe('visit-image blink — per-epoch decode (real DP1 cutout)', () => {
  it('decodes an epoch frame to a non-empty FitsImage with finite pixels + WCS', async () => {
    const image = await readFitsImageAsync(ab);

    // Non-empty image the blink can render.
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
    expect(image.data.length).toBe(image.width * image.height);

    // Every pixel is a finite float (a real decode, not zeros/NaNs), and the frame
    // has genuine dynamic range (a flat frame would be a decode failure).
    let finite = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const v of image.data) {
      if (Number.isFinite(v)) {
        finite++;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    expect(finite).toBe(image.data.length);
    expect(max).toBeGreaterThan(min);

    // Real WCS carried through from the compressed extension header — a blink
    // frame is sky-calibrated, not a bare array.
    expect(image.header.ctype1).toBe('RA---TAN');
    expect(image.header.ctype2).toBe('DEC--TAN');
    expect(Number.isFinite(image.header.crval1!)).toBe(true);
    expect(Number.isFinite(image.header.crval2!)).toBe(true);
  });

  it('renders the decoded epoch to a full-length RGBA buffer (the blink draw path)', async () => {
    const image = await readFitsImageAsync(ab);
    const r = renderCutout(image, { scale: 'asinh', colormap: 'grayscale' });
    expect(r.rgba.length).toBe(image.width * image.height * 4);
    // A real stretch spans a finite range (a constant renderer could not).
    expect(Number.isFinite(r.min)).toBe(true);
    expect(Number.isFinite(r.max)).toBe(true);
    expect(r.max).toBeGreaterThan(r.min);
  });
});

/**
 * REAL-DATA regression for the DISCOVERY parse. `dp1-visit-image-obscore.vot.xml`
 * is a VERBATIM live ivoa.ObsCore response (binary2) for lsst.visit_image at a
 * covered EDFS position (RA 59.28107, Dec -48.98508) — 200 real per-visit epochs.
 * This proves parseVisitImageEpochs handles the REAL column names/types/ID shape,
 * not a hand-invented mock (the failure class CLAUDE.md warns about).
 */
describe('visit-image blink — epoch discovery (real ObsCore VOTable)', () => {
  const xml = readFileSync('tests/fixtures/dp1-visit-image-obscore.vot.xml', 'utf-8');
  const vt = parseVotable(xml);
  const result: TapQueryResult = {
    status: 'completed',
    rowCount: vt.rows.length,
    columns: vt.fields.map((f) => ({ name: f.name, datatype: f.datatype, unit: f.unit })),
    rows: vt.rows,
  };

  it('parses many distinct real epochs, sorted ascending, with string IDs + bands', () => {
    const epochs = parseVisitImageEpochs(result);

    // Real position yields MANY per-visit epochs (a coadd would be one) across bands.
    expect(epochs.length).toBeGreaterThan(20);
    expect(new Set(epochs.map((e) => e.mjd)).size).toBe(epochs.length); // distinct epochs
    expect(new Set(epochs.map((e) => e.band)).size).toBeGreaterThan(1); // multiple bands

    // Ascending by MJD — the blink plays oldest → newest.
    for (let i = 1; i < epochs.length; i++) {
      expect(epochs[i]!.mjd).toBeGreaterThanOrEqual(epochs[i - 1]!.mjd);
    }

    // 64-bit-safe: the SODA dataset ID is a non-empty STRING extracted from the
    // real DataLink access_url (never a truncated number).
    expect(typeof epochs[0]!.id).toBe('string');
    expect(epochs[0]!.id.length).toBeGreaterThan(0);
    expect(epochs[0]!.accessUrl).toContain('ID=');
  });
});
