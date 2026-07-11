/**
 * RGB composite OUTCOME test (feature 120), deterministic via page.route.
 *
 * We route the two network steps of the cutout pipeline for each of the three
 * bands (i, r, g) so the test needs no live RSP:
 *   1. ObsTAP discovery (`**\/api/tap/sync`) → one ObsCore row per band whose
 *      access_url carries a band-specific DataLink ID (`deep-<band>`), chosen by
 *      reading the `lsst_band` in the POSTed ADQL.
 *   2. SODA cutout (`**\/api/cutout/**`) → a per-band FITS chosen from the `ID`
 *      query param. Band `i` is bright, `r` medium, `g` faint, so the default
 *      i→R r→G g→B mapping MUST yield a red-dominant (coloured, not grey) image.
 * We then assert the failure-visible OUTCOMES CLAUDE.md demands: the composite
 * canvas paints, its pixels are COLOURED (channels differ — a grayscale impl
 * fails), and swapping the R-channel band CHANGES the pixels (a fixed/ignored
 * mapping fails).
 */

import { test, expect, type Page } from '@playwright/test';

const BLOCK = 2880;
const CARD = 80;

function card(text: string): string {
  return text.padEnd(CARD, ' ');
}
function valueCard(keyword: string, value: string): string {
  return card(`${keyword.padEnd(8, ' ').slice(0, 8)}= ${value}`);
}
function buildHeaderBytes(cards: string[]): Uint8Array {
  const all = [...cards, card('END')];
  let text = all.join('');
  const blocks = Math.ceil(text.length / BLOCK);
  text = text.padEnd(blocks * BLOCK, ' ');
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** A WIDTH×HEIGHT float32 FITS filled with a single per-band level + TAN WCS. */
function buildBandFits(level: number, width = 16, height = 16): Buffer {
  const cards = [
    valueCard('SIMPLE', 'T'),
    valueCard('BITPIX', '-32'),
    valueCard('NAXIS', '2'),
    valueCard('NAXIS1', String(width)),
    valueCard('NAXIS2', String(height)),
    valueCard('BUNIT', "'nJy     '"),
    valueCard('CRPIX1', String((width + 1) / 2)),
    valueCard('CRPIX2', String((height + 1) / 2)),
    valueCard('CRVAL1', '62.0'),
    valueCard('CRVAL2', '-37.0'),
    valueCard('CD1_1', '-0.0001'),
    valueCard('CD1_2', '0.0'),
    valueCard('CD2_1', '0.0'),
    valueCard('CD2_2', '0.0001'),
    valueCard('CTYPE1', "'RA---TAN'"),
    valueCard('CTYPE2', "'DEC--TAN'"),
  ];
  const header = buildHeaderBytes(cards);
  const pixelCount = width * height;
  const dataBytes = pixelCount * 4;
  const dataBlocks = Math.ceil(dataBytes / BLOCK);
  const buffer = new ArrayBuffer(header.length + dataBlocks * BLOCK);
  new Uint8Array(buffer).set(header, 0);
  const view = new DataView(buffer, header.length);
  for (let i = 0; i < pixelCount; i++) view.setFloat32(i * 4, level); // big-endian
  return Buffer.from(buffer);
}

// Per-band brightness: i (→R) bright, r (→G) medium, g (→B) faint.
const BAND_LEVEL: Record<string, number> = { i: 120, r: 30, g: 4 };

async function seedToken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('rubin_rsp_token', 'fake-test-token');
    } catch {
      /* ignore */
    }
  });
}

async function routeBands(page: Page): Promise<void> {
  // ObsTAP discovery: read lsst_band from the POSTed ADQL, return a band-specific ID.
  await page.route('**/api/tap/sync', (route) => {
    const body = route.request().postData() ?? '';
    // Form-encoded bodies use '+' for spaces; convert before decoding %XX so the
    // ADQL whitespace survives (decodeURIComponent leaves '+' intact).
    const decoded = decodeURIComponent(body.replace(/\+/g, ' '));
    const m = decoded.match(/lsst_band\s*=\s*'([ugrizy])'/);
    const band = m?.[1] ?? 'r';
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            access_format: 'application/x-votable+xml;content=datalink',
            access_url: `https://data.lsst.cloud/api/datalink/links?ID=deep-${band}`,
            dataproduct_subtype: 'lsst.deep_coadd',
            lsst_band: band,
            s_ra: 62.0,
            s_dec: -37.0,
          },
        ],
      }),
    });
  });

  // SODA cutout: pick the FITS by the ID query param (deep-<band>).
  await page.route('**/api/cutout/**', (route) => {
    const url = route.request().url();
    const m = url.match(/ID=deep-([ugrizy])/);
    const band = m?.[1] ?? 'r';
    route.fulfill({
      status: 200,
      contentType: 'application/fits',
      body: buildBandFits(BAND_LEVEL[band] ?? 10),
    });
  });
}

/** Read the native-resolution RGBA of the composite canvas. */
async function readComposite(page: Page): Promise<number[]> {
  const canvas = page.locator('canvas[aria-label="RGB composite image"]');
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    return Array.from(ctx.getImageData(0, 0, el.width, el.height).data);
  });
}

test('RGB composite: renders a COLOURED image and the band→channel mapping is live', async ({ page }) => {
  await seedToken(page);
  await routeBands(page);

  await page.goto('/');
  await page.waitForTimeout(400);

  await page.locator('button[aria-label="Toggle RGB composite"]').click();

  const panel = page.locator('[aria-label="RGB composite"]');
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(page.locator('canvas[aria-label="RGB composite image"]')).toBeVisible();

  // The default mapping is i→R, r→G, g→B (longer wavelength → red).
  await expect(page.locator('select[aria-label="R channel band"]')).toHaveValue('i');
  await expect(page.locator('select[aria-label="G channel band"]')).toHaveValue('r');
  await expect(page.locator('select[aria-label="B channel band"]')).toHaveValue('g');

  // The composite is COLOURED: for an opaque pixel the channels differ (R>B here
  // because i is bright and g is faint). A grayscale impl (R==G==B) would fail.
  const before = await readComposite(page);
  let colouredPixels = 0;
  let redDominant = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (before[i + 3]! === 0) continue; // transparent
    const r = before[i]!, g = before[i + 1]!, b = before[i + 2]!;
    if (r !== g || g !== b) colouredPixels++;
    if (r > b) redDominant++;
  }
  expect(colouredPixels).toBeGreaterThan(0);
  expect(redDominant).toBeGreaterThan(0);

  // Swapping which band feeds R changes the pixels (a fixed/ignored mapping fails).
  await page.selectOption('select[aria-label="R channel band"]', 'g');
  await page.waitForTimeout(150);
  const after = await readComposite(page);
  let changed = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) changed++;
  }
  expect(changed).toBeGreaterThan(0);
});
