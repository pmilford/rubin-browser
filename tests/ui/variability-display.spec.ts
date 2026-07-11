/**
 * Variability-map DISPLAY OUTCOME test (feature 124 display). Toggling variability
 * on the OFFLINE cube jumps to the known synthetic transient and shows a per-pixel
 * temporal-σ heatmap + a detected variable-source list. Asserts the OUTCOME (a hot
 * spot is painted AND at least one variable source is detected) — a constant-field
 * or no-op implementation finds nothing and paints black, and fails.
 */

import { test, expect, type Page } from '@playwright/test';

async function goOffline(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('select[aria-label="Base layer"]').selectOption('offline');
  await page.waitForTimeout(900);
}

test.describe('Variability display (offline synthetic cube)', () => {
  test('toggle → jumps to the transient, detects a variable source, and paints a hot map', async ({
    page,
  }) => {
    await goOffline(page);

    // The toggle exists only in offline mode (a single Rubin coadd has no time axis).
    const toggle = page.locator('button[aria-label="Toggle variability map"]');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await page.waitForTimeout(600);

    const panel = page.locator('[aria-label="Variability map"]');
    await expect(panel).toBeVisible();

    // A KNOWN transient is in view → at least one variable source is detected
    // (not a placeholder / not zero).
    const count = (await page.locator('[aria-label="Variable source count"]').textContent()) ?? '';
    expect(parseInt(count, 10)).toBeGreaterThan(0);
    await expect(page.locator('[aria-label="Variable source list"]')).toContainText('σ=');

    // The heatmap canvas actually paints hot (non-black) pixels where the sky varies.
    const litFraction = await page
      .locator('canvas[aria-label="Variability map canvas"]')
      .evaluate((el: HTMLCanvasElement) => {
        const ctx = el.getContext('2d');
        if (!ctx) return 0;
        const { data } = ctx.getImageData(0, 0, el.width, el.height);
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i]! > 40 || data[i + 1]! > 40) lit++; // red/orange/yellow hot ramp
        }
        return lit / (data.length / 4);
      });
    expect(litFraction).toBeGreaterThan(0); // a hot spot exists — not an all-black map
  });

  test('the variability toggle is absent on the DSS base (needs a time axis)', async ({ page }) => {
    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('dss');
    await page.waitForTimeout(400);
    await expect(page.locator('button[aria-label="Toggle variability map"]')).toHaveCount(0);
  });
});
