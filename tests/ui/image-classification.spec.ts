/**
 * Image-inferred object classification (feature 123) OUTCOME test — drives the
 * REAL cursor→cutout→classify seam end-to-end over the OFFLINE synthetic cube,
 * which contains a KNOWN extended galaxy (OFFLINE_GALAXY) and a KNOWN point-source
 * star (OFFLINE_STAR) at fixed positions. This is the integration coverage the
 * pure confusion-matrix harness cannot give (it bypasses sampleCutoutAt's cutout
 * extraction, pixel-scale, and gap handling).
 *
 * Asserts OUTCOMES, not existence:
 *  - the extended galaxy classifies as "Galaxy", the point source as "Star"
 *    (a swapped/constant classifier fails — the two labels must differ);
 *  - the classification is INVARIANT under display stretch/colormap/invert
 *    (proves features come from the pre-colormap raster, not the displayed RGB);
 *  - empty sky is honestly "Uncertain", never a fabricated class.
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForTiles(page: Page, quietMs = 700, hardCapMs = 10000): Promise<void> {
  await page.waitForTimeout(300);
  const start = Date.now();
  let last = Date.now();
  const onResp = (r: { url(): string }): void => {
    if (/Norder\d+.*Npix\d+/.test(r.url())) last = Date.now();
  };
  page.on('response', onResp);
  while (Date.now() - last <= quietMs && Date.now() - start <= hardCapMs) {
    await page.waitForTimeout(120);
  }
  page.off('response', onResp);
  await page.waitForTimeout(200);
}

async function goTo(page: Page, coords: string): Promise<void> {
  const input = page.locator('input[aria-label="Search coordinates"]');
  await input.fill(coords);
  await input.press('Enter');
  await waitForTiles(page);
}

// The classifier resolves star-vs-galaxy only in a pixel-scale window (the cutout
// must resolve the PSF but the source must not be so oversampled it drops below the
// SNR floor). From a fresh default view, 3 zoom-ins on the offline cube lands at
// ~8″/px — the sweet spot for the injected sources (offline beam is ~45–90″).
const ZOOM_INS = 3;

/** Fresh page → offline base → centre on a target → zoom into the classify window. */
async function focusOfflineTarget(page: Page, coords: string, zoomIns = ZOOM_INS): Promise<void> {
  await page.goto('/');
  await page.locator('select[aria-label="Base layer"]').selectOption('offline');
  await waitForTiles(page);
  await goTo(page, coords);
  for (let i = 0; i < zoomIns; i++) await page.locator('button[aria-label="Zoom in"]').click();
  await waitForTiles(page);
}

async function clickCentreAndRead(page: Page): Promise<string> {
  const canvas = page.locator('.hips-canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(450); // identify+classify is debounced ~220ms
  const block = page.locator('[aria-label="Image-inferred classification"]');
  await expect(block).toBeVisible();
  return (await block.locator('[aria-label="Inferred class"]').textContent())?.trim() ?? '';
}

test.describe('Image-inferred classification (offline synthetic cube)', () => {
  test('the extended galaxy → "Galaxy", the point source → "Star" (labels differ)', async ({ page }) => {
    await focusOfflineTarget(page, '150, 20'); // OFFLINE_GALAXY
    const galaxyLabel = await clickCentreAndRead(page);
    expect(galaxyLabel).toMatch(/Galaxy/i);
    expect(galaxyLabel).toMatch(/image-inferred/i);

    await focusOfflineTarget(page, '150, 22'); // OFFLINE_STAR
    const starLabel = await clickCentreAndRead(page);
    expect(starLabel).toMatch(/Star/i);

    // A constant/swapped classifier would give the same label for both — it must not.
    expect(starLabel).not.toBe(galaxyLabel);
  });

  test('classification is INVARIANT under stretch / colormap / invert (pre-colormap sampling)', async ({ page }) => {
    await focusOfflineTarget(page, '150, 22'); // the star

    const before = await clickCentreAndRead(page);
    expect(before).toMatch(/Star/i);

    // Change every display transform; features must NOT be sampled from displayed RGB.
    await page.locator('button[aria-label="Invert image"]').click();
    await page.locator('button[aria-label="Toggle controls panel"]').click();
    await page.waitForTimeout(300);
    await page.locator('#scaling-select').selectOption('log');
    await page.locator('#colormap-select').selectOption('viridis');
    await waitForTiles(page);

    const after = await clickCentreAndRead(page);
    expect(after).toBe(before); // identical class label despite a totally different display
  });

  test('empty sky is honestly "Uncertain", never a fabricated class', async ({ page }) => {
    await focusOfflineTarget(page, '150, 40'); // away from the injected sources
    const canvas = page.locator('.hips-canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(450);

    const block = page.locator('[aria-label="Image-inferred classification"]');
    await expect(block).toBeVisible();
    await expect(block).toContainText(/Uncertain|Cannot classify/i);
  });
});
