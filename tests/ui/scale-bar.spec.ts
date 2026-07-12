/**
 * Scale-bar visibility OUTCOME test (TODO 137).
 *
 * PROCESS-GAP GUARD: the scale bar was drawn inside renderGraticule(), which
 * early-returns when the coordinate grid is off — and the grid is OFF BY DEFAULT
 * (showGraticule = false). So the scale bar was effectively invisible in normal
 * use, and no test caught it because none asserted the bar renders with the grid
 * OFF. This spec drives the DEFAULT view (grid off) on the deterministic offline
 * cube (dark sky → a white bar is unambiguous) and asserts the bar's bright pixels
 * are present in the bottom-right, and that toggling the grid does NOT gate it.
 *
 * A pre-fix build (bar gated on the graticule) FAILS the grid-off assertion.
 */
import { test, expect, type Page } from '@playwright/test';

/** Count near-white pixels in the bottom-right scale-bar band (canvas coords). */
async function scaleBarWhitePixels(page: Page): Promise<number> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const { width: w, height: h } = el;
    // The bar sits at y ≈ h-26, right-anchored at x ≈ w-24 extending left. Scan a
    // generous band around it (bottom-right only — the compass is bottom-LEFT).
    const x0 = Math.max(0, w - 160), x1 = w - 10;
    const y0 = Math.max(0, h - 40), y1 = Math.min(h, h - 12);
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let white = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! > 200 && d[i + 1]! > 200 && d[i + 2]! > 200) white++;
    }
    return white;
  });
}

async function useOfflineBase(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.hips-canvas').first().waitFor({ timeout: 10000 });
  await page.locator('select[aria-label="Base layer"]').selectOption('offline');
  await page.waitForTimeout(1200); // let the offline cube render
}

test('the scale bar is visible in the DEFAULT view (coordinate grid OFF)', async ({ page }) => {
  await useOfflineBase(page);
  // Grid is off by default — this is the exact state a user sees and where the bar
  // used to vanish. The bar's bright pixels MUST still be present.
  await expect
    .poll(() => scaleBarWhitePixels(page), { timeout: 6000 })
    .toBeGreaterThan(10);
});

test('toggling the coordinate grid does NOT gate the scale bar (decoupled)', async ({ page }) => {
  await useOfflineBase(page);
  const off = await scaleBarWhitePixels(page);
  await page.locator('button[aria-label="Toggle coordinate grid"]').click();
  await page.waitForTimeout(400);
  const on = await scaleBarWhitePixels(page);
  // Present in BOTH states (the bar no longer depends on the grid). A regression
  // that re-couples them would drop `off` to ~0.
  expect(off).toBeGreaterThan(10);
  expect(on).toBeGreaterThan(10);
});
