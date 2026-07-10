/**
 * Multi-epoch + multi-wavelength OFFLINE browsing — OUTCOME tests on real pixels.
 *
 * These prove the epoch/band controls are actually WIRED to what is drawn (the
 * project's recurring failure class: a control that changes state but not the
 * canvas). Correctness of the SIGNAL vs. noise is proven in the unit tests
 * (offlineDataset.multiepoch.test.ts, noise off); here we assert the canvas
 * repaints in the right DIRECTION and that the post-processing memo stays honest.
 */

import { test, expect, type Page } from '@playwright/test';

/** Mean luminance of a box centred where "Find a transient" places the source. */
async function centreLum(page: Page): Promise<number> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const { width: w, height: h } = el;
    const x0 = Math.floor(w * 0.45), y0 = Math.floor(h * 0.45);
    const d = ctx.getImageData(x0, y0, Math.ceil(w * 0.1), Math.ceil(h * 0.1)).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s += (d[i]! + d[i + 1]! + d[i + 2]!) / 3; n++; }
    return s / n;
  });
}

/** Mean luminance of the WHOLE canvas — catches a fully-black composite. */
async function fullLum(page: Page): Promise<number> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const { width: w, height: h } = el;
    const d = ctx.getImageData(0, 0, w, h).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s += (d[i]! + d[i + 1]! + d[i + 2]!) / 3; n++; }
    return s / n;
  });
}

/** Count of bright pixels in the central region (source blob size). */
async function centreBright(page: Page): Promise<number> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const { width: w, height: h } = el;
    const x0 = Math.floor(w * 0.4), y0 = Math.floor(h * 0.4);
    const d = ctx.getImageData(x0, y0, Math.ceil(w * 0.2), Math.ceil(h * 0.2)).data;
    let c = 0;
    for (let i = 0; i < d.length; i += 4) { if ((d[i]! + d[i + 1]! + d[i + 2]!) / 3 > 180) c++; }
    return c;
  });
}

async function enterOffline(page: Page) {
  await page.goto('/');
  await page.waitForTimeout(600);
  await page.locator('select[aria-label="Base layer"]').selectOption('offline');
  await expect(page.locator('.synthetic-banner')).toContainText('SYNTHETIC', { timeout: 8000 });
  await expect(page.locator('.offline-controls')).toBeVisible();
}

const band = (page: Page, b: string) =>
  page.locator(`.offline-controls button[aria-label="Band ${b}"]`);

test.describe('Offline multi-epoch / multi-band UI', () => {
  test('epoch/band controls exist ONLY in offline mode', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);
    await expect(page.locator('.offline-controls')).toHaveCount(0); // auto→DSS
    await page.locator('select[aria-label="Base layer"]').selectOption('offline');
    await expect(page.locator('.offline-controls')).toHaveCount(1);
    await page.locator('select[aria-label="Base layer"]').selectOption('dss');
    await expect(page.locator('.offline-controls')).toHaveCount(0);
  });

  test('scrubbing epochs makes the demo transient rise and fade (epoch axis wired)', async ({ page }: { page: Page }) => {
    await enterOffline(page);
    await page.locator('button[aria-label="Find a transient"]').click();
    await page.waitForTimeout(1300); // synth + render at the transient (peak epoch)

    const peak = await centreLum(page);

    // Epoch 0 — the transient is faded there for this seed (see the unit test's
    // brightestOfflineVariable: faint epoch index 0). Region-mean averages out the
    // per-epoch noise, so this direction reflects SIGNAL, not noise.
    const slider = page.locator('.offline-controls input[aria-label="Epoch"]');
    await slider.fill('0');
    await page.waitForTimeout(1000);
    const faded = await centreLum(page);

    // ~43 at peak vs ~13 (background) faded — a dead slider leaves them equal.
    expect(peak).toBeGreaterThan(faded + 15);
  });

  test('switching band changes the source AND returning reproduces it (band wired, memo honest)', async ({ page }: { page: Page }) => {
    await enterOffline(page);
    await page.locator('button[aria-label="Find a transient"]').click();
    await page.waitForTimeout(1300);

    await band(page, 'g').click();
    await page.waitForTimeout(900);
    const gBright = await centreBright(page);

    await band(page, 'y').click();
    await page.waitForTimeout(900);
    const yBright = await centreBright(page);

    await band(page, 'g').click();
    await page.waitForTimeout(900);
    const gAgain = await centreBright(page);

    // y is intrinsically brighter than g for this SED (BAND_COLOR_OFFSET), so its
    // saturated core is larger. And returning to g reproduces the g frame exactly
    // — a memo that served a stale y composite would not.
    expect(yBright).toBeGreaterThan(gBright + 8);
    expect(Math.abs(gAgain - gBright)).toBeLessThan(5);
  });

  test('post-processing composite never blacks out on epoch-return or resize (memo regression)', async ({ page }: { page: Page }) => {
    await enterOffline(page);
    await page.locator('button[aria-label="Find a transient"]').click();
    await page.waitForTimeout(1300);

    // Force the memoized post-processing path (invert makes needsPostProcessing true).
    await page.locator('.hips-canvas').first().click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('i');
    await page.waitForTimeout(600);
    const invLum = await fullLum(page);
    expect(invLum).toBeGreaterThan(60); // inverted background is bright

    const slider = page.locator('.offline-controls input[aria-label="Epoch"]');
    await slider.fill('0');
    await page.waitForTimeout(1000);
    // Return to a CACHED epoch (bumps no contentVersion): the offscreen must not be
    // served stale-black. Regression for the resize/offscreen-clear memo bug.
    await slider.fill('4');
    await page.waitForTimeout(1000);
    expect(await fullLum(page)).toBeGreaterThan(60);

    // A real viewport resize while post-processing is active must not black out.
    await page.setViewportSize({ width: 1000, height: 720 });
    await page.waitForTimeout(700);
    expect(await fullLum(page)).toBeGreaterThan(60);
  });
});
