/**
 * Aperture / radial-profile photometry OUTCOME test (feature 122), deterministic
 * via page.route. Reuses the single-band cutout pipeline routes (ObsTAP discovery
 * + SODA cutout) to serve a synthetic FITS with a BRIGHT CENTRAL SOURCE (a small
 * Gaussian-ish peak). We open the cutout, enter Measure mode, click the centre,
 * and assert the failure-visible OUTCOMES: the aperture overlay is DRAWN over the
 * clicked point, a non-empty radial profile / curve-of-growth renders, and a net
 * flux is reported. A dead measure control (no overlay, empty plot) fails.
 */

import { test, expect, type Page } from '@playwright/test';
import { votableFromRows } from './helpers/votable.js';

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

/** A 32×32 float32 FITS with a centred Gaussian source over a small flat sky. */
function buildSourceFits(width = 32, height = 32): Buffer {
  const cards = [
    valueCard('SIMPLE', 'T'),
    valueCard('BITPIX', '-32'),
    valueCard('NAXIS', '2'),
    valueCard('NAXIS1', String(width)),
    valueCard('NAXIS2', String(height)),
    valueCard('OBJECT', "'PHOTOM-SRC'"),
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
  const cx = (width + 1) / 2;
  const cy = (height + 1) / 2;
  const sigma = 3;
  const sky = 2;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const dx = col + 1 - cx;
      const dy = row + 1 - cy;
      const value = sky + 500 * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      view.setFloat32((row * width + col) * 4, value);
    }
  }
  return Buffer.from(buffer);
}

const OBSCORE_ROWS = [
  {
    access_format: 'application/x-votable+xml;content=datalink',
    access_url: 'https://data.lsst.cloud/api/datalink/links?ID=photom-id',
    dataproduct_subtype: 'lsst.deep_coadd',
    lsst_band: 'r',
    s_ra: 62.0,
    s_dec: -37.0,
  },
];

async function seedToken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('rubin_rsp_token', 'fake-test-token');
    } catch {
      /* ignore */
    }
  });
}

test('Photometry: click the centre → aperture overlay + non-empty radial profile + net flux', async ({ page }) => {
  await seedToken(page);
  const fits = buildSourceFits(32, 32);
  await page.route('**/api/tap/sync', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-votable+xml', body: votableFromRows(OBSCORE_ROWS) })
  );
  await page.route('**/api/cutout/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/fits', body: fits })
  );

  await page.goto('/');
  await page.waitForTimeout(400);

  // Open the cutout tool and wait for the panel + image.
  await page.locator('button[aria-label="Toggle FITS cutout"]').click();
  const panel = page.locator('[aria-label="FITS cutout"]');
  await expect(panel).toBeVisible({ timeout: 15000 });
  const canvas = page.locator('canvas[aria-label="FITS cutout image"]');
  await expect(canvas).toBeVisible();

  // Enter measure mode → the aperture-radius control appears; no overlay yet.
  await page.locator('button[aria-label="Toggle measure mode"]').click();
  await expect(page.locator('[aria-label="Aperture radius"]')).toBeVisible();
  await expect(page.locator('svg[aria-label="Aperture overlay"]')).toHaveCount(0);

  // Click the centre of the canvas (over the source).
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // The aperture overlay is now DRAWN (a circle over the clicked point).
  await expect(page.locator('svg[aria-label="Aperture overlay"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('circle[aria-label="Aperture circle"]')).toBeVisible();

  // A non-empty radial profile / curve-of-growth renders (the polyline has points).
  const growth = page.locator('polyline[aria-label="Curve of growth line"]');
  await expect(growth).toBeVisible();
  const points = await growth.getAttribute('points');
  expect(points).not.toBeNull();
  expect(points!.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThan(2);

  // The photometry readout reports a net flux with the BUNIT from the header.
  const readout = page.locator('[aria-label="Photometry readout"]');
  await expect(readout).toBeVisible();
  await expect(readout).toContainText(/net flux/);
  await expect(readout).toContainText('nJy');
  // Net flux of a bright source over a small sky is clearly positive (a
  // background-sign or no-source bug would give ~0 or negative).
  const text = (await readout.textContent()) ?? '';
  const m = text.match(/net flux\s*([\d.eE+-]+)/);
  expect(m).not.toBeNull();
  expect(Number(m![1])).toBeGreaterThan(0);
});
