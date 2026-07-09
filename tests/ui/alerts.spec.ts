/**
 * Alert/DIA overlay: renders, filters by type, and stays populated at full sky
 * via the density LOD. (Performance at volume is guaranteed structurally — the
 * spatial index culls to the viewport and the renderer caps work at O(cells)
 * once past the marker limit; the unit tests cover the index/culling.)
 */

import { test, expect, type Page } from '@playwright/test';

async function alertPixelCount(page: Page): Promise<number> {
  return page.locator('canvas.alert-canvas').evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const d = ctx.getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4 * 5) if (d[i]! > 0) n++;
    return n;
  });
}

test.describe('Alert overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('renders when enabled, filters by type, and shows density at full sky', async ({ page }) => {
    test.setTimeout(90000);

    // Off by default → overlay is empty.
    expect(await alertPixelCount(page)).toBe(0);

    await page.locator('button[aria-label="Toggle alert overlay"]').click();
    await page.waitForTimeout(1200);
    const withAll = await alertPixelCount(page);
    expect(withAll).toBeGreaterThan(50);

    // Turning types off must paint strictly fewer pixels.
    await page.locator('button[aria-label="Toggle asteroid alerts"]').click();
    await page.locator('button[aria-label="Toggle variable alerts"]').click();
    await page.locator('button[aria-label="Toggle satellite alerts"]').click();
    await page.waitForTimeout(600);
    const fewer = await alertPixelCount(page);
    expect(fewer).toBeLessThan(withAll);

    // Re-enable, zoom to full sky → density LOD keeps it populated.
    await page.locator('button[aria-label="Toggle asteroid alerts"]').click();
    await page.locator('button[aria-label="Toggle variable alerts"]').click();
    await page.locator('button[aria-label="Toggle satellite alerts"]').click();
    for (let i = 0; i < 6; i++) {
      await page.locator('button[aria-label="Zoom out"]').click();
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(800);
    expect(await alertPixelCount(page)).toBeGreaterThan(100);

    // Toggling the overlay off clears it.
    await page.locator('button[aria-label="Toggle alert overlay"]').click();
    await page.waitForTimeout(500);
    expect(await alertPixelCount(page)).toBe(0);
  });
});
