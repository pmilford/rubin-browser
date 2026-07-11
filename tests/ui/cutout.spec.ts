/**
 * FITS cutout display OUTCOME test (feature 109), deterministic via page.route.
 *
 * We route the two network steps of the cutout pipeline so the test needs no
 * live RSP:
 *   1. ObsTAP discovery (`**\/api/tap/sync`) → one ObsCore row whose access_url
 *      carries the DataLink ID `test-id`.
 *   2. SODA cutout (`**\/api/cutout/**`) → a small, VALID primary-HDU FITS we
 *      build here (float32, a TAN WCS about RA 150 / Dec 2, a gradient + a bright
 *      centre pixel).
 * An RSP token is seeded so `isAuthenticated()` is true (the client gates on auth
 * before any request). We then assert the failure-visible OUTCOMES CLAUDE.md
 * demands: the panel appears, the canvas paints NON-BLACK pixels (getImageData
 * fingerprint — a black/placeholder canvas fails), and a mousemove yields a
 * PLAUSIBLE calibrated RA/Dec (~150, ~2 — a zeroed/decoupled readout fails).
 * A second test drives the zero-rows path and asserts the honest "No DP1 …
 * covers" message shows instead of a blank canvas.
 */

import { test, expect, type Page } from '@playwright/test';

// --- Synthetic FITS builder (mirrors tests/unit/fits.test.ts byte layout) ----
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

/**
 * Build a WIDTH×HEIGHT float32 FITS with a TAN WCS about (150, 2), a value
 * gradient (so the render has spread), and a bright central pixel. Returns raw
 * bytes for page.route to serve.
 */
function buildCutoutFits(width = 16, height = 16): Buffer {
  const cards = [
    valueCard('SIMPLE', 'T'),
    valueCard('BITPIX', '-32'),
    valueCard('NAXIS', '2'),
    valueCard('NAXIS1', String(width)),
    valueCard('NAXIS2', String(height)),
    valueCard('OBJECT', "'CUTOUT-TEST'"),
    valueCard('BUNIT', "'nJy     '"),
    valueCard('CRPIX1', String((width + 1) / 2)),
    valueCard('CRPIX2', String((height + 1) / 2)),
    valueCard('CRVAL1', '150.0'),
    valueCard('CRVAL2', '2.0'),
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
  const centre = Math.floor(height / 2) * width + Math.floor(width / 2);
  for (let i = 0; i < pixelCount; i++) {
    const value = i === centre ? 5000 : (i % 255) + 1; // gradient + bright core
    view.setFloat32(i * 4, value); // big-endian (FITS)
  }
  return Buffer.from(buffer);
}

async function seedToken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('rubin_rsp_token', 'fake-test-token');
    } catch {
      /* ignore */
    }
  });
}

/** One ObsCore row whose access_url carries the DataLink ID `test-id`. */
const OBSCORE_ONE_ROW = {
  data: [
    {
      access_format: 'application/x-votable+xml;content=datalink',
      access_url: 'https://data.lsst.cloud/api/datalink/links?ID=test-id',
      dataproduct_subtype: 'lsst.deep_coadd',
      lsst_band: 'r',
      s_ra: 62.0,
      s_dec: -37.0,
    },
  ],
};

test('FITS cutout: panel renders non-black pixels and a plausible RA/Dec readout', async ({ page }) => {
  await seedToken(page);

  const fits = buildCutoutFits(16, 16);
  await page.route('**/api/tap/sync', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OBSCORE_ONE_ROW) })
  );
  await page.route('**/api/cutout/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/fits', body: fits })
  );

  await page.goto('/');
  await page.waitForTimeout(400);

  // Open the cutout tool → it fetches and displays.
  await page.locator('button[aria-label="Toggle FITS cutout"]').click();

  // The panel appears with the parsed FITS metadata (OBJECT from the header).
  const panel = page.locator('[aria-label="FITS cutout"]');
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel.locator('[aria-label="Cutout metadata"]')).toContainText('CUTOUT-TEST');

  // The canvas actually paints NON-BLACK pixels (not a placeholder/black panel).
  const canvas = page.locator('canvas[aria-label="FITS cutout image"]');
  await expect(canvas).toBeVisible();
  const nonBlack = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const d = ctx.getImageData(0, 0, el.width, el.height).data;
    let nb = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! + d[i + 1]! + d[i + 2]! > 10 && d[i + 3]! > 0) nb++;
    }
    return nb;
  });
  expect(nonBlack).toBeGreaterThan(0);

  // Move the cursor to the centre of the canvas → the WCS readout must show an
  // RA/Dec close to the reference point (150, 2) — a decoupled/zeroed readout fails.
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const readout = page.locator('[aria-label="Cutout readout"]');
  await expect(readout).toContainText(/RA\s*1\d\d\.\d/, { timeout: 5000 });
  const text = (await readout.textContent()) ?? '';
  const raMatch = text.match(/RA\s*([\d.]+)/);
  const decMatch = text.match(/Dec\s*([+-]?[\d.]+)/);
  expect(raMatch).not.toBeNull();
  expect(decMatch).not.toBeNull();
  expect(Number(raMatch![1])).toBeGreaterThan(149.9);
  expect(Number(raMatch![1])).toBeLessThan(150.1);
  expect(Number(decMatch![1])).toBeGreaterThan(1.9);
  expect(Number(decMatch![1])).toBeLessThan(2.1);
});

test('FITS cutout: zero ObsCore rows shows the honest "No DP1 … covers" message, not a blank canvas', async ({ page }) => {
  await seedToken(page);

  // ObsTAP discovery returns NO rows → discoverCutoutId throws the honest error.
  await page.route('**/api/tap/sync', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  );

  await page.goto('/');
  await page.waitForTimeout(400);

  await page.locator('button[aria-label="Toggle FITS cutout"]').click();

  // No image canvas — instead the error message, VERBATIM from the thrown error.
  const err = page.locator('[aria-label="Cutout error"]');
  await expect(err).toBeVisible({ timeout: 15000 });
  await expect(err).toContainText(/No DP1/);
  await expect(err).toContainText(/covers/);
  // And there is NO cutout image canvas (never a blank/black panel masquerading).
  await expect(page.locator('canvas[aria-label="FITS cutout image"]')).toHaveCount(0);
});
