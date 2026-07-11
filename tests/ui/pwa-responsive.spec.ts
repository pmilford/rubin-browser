/**
 * PWA installability + responsive-layout OUTCOME tests (feature 127).
 *  - The manifest is linked, fetchable, and valid (name, standalone, real icons),
 *    and the icons actually load — the essentials a browser needs to offer install.
 *  - On a phone-width viewport the page does not overflow horizontally and the
 *    control cluster stays on-screen (the responsive breakpoints do their job).
 * The service worker itself registers only in a production build (PROD-guarded to
 * avoid clobbering Vite HMR), so its shell-caching is validated by the build copy
 * + its own logic, not asserted in the dev server here.
 */

import { test, expect, type Page } from '@playwright/test';

test.describe('PWA installability', () => {
  test('manifest is linked, valid, and its icons load', async ({ page }) => {
    await page.goto('/');

    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);

    const manifestUrl = new URL(href!, page.url()).toString();
    const res = await page.request.get(manifestUrl);
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.name).toMatch(/Rubin/i);
    expect(m.display).toBe('standalone');
    expect(Array.isArray(m.icons) && m.icons.length).toBeTruthy();
    const hasMaskable = m.icons.some((i: { purpose?: string }) => /maskable/.test(i.purpose ?? ''));
    expect(hasMaskable).toBe(true);

    // Each declared icon must actually load (a 404 icon breaks install).
    for (const icon of m.icons as { src: string }[]) {
      const iconUrl = new URL(icon.src, manifestUrl).toString();
      const ir = await page.request.get(iconUrl);
      expect(ir.ok(), `icon ${icon.src} should load`).toBe(true);
      expect(ir.headers()['content-type']).toMatch(/image\/png/);
    }
  });
});

test.describe('Responsive layout', () => {
  async function horizontalOverflow(page: Page): Promise<number> {
    return page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
  }

  test('no horizontal overflow on a phone viewport; controls stay on-screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone-ish
    await page.goto('/');
    await page.waitForTimeout(600);

    // The page must not scroll sideways (a common mobile-layout break).
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);

    // The control cluster and base selector remain visible and within the viewport.
    const layers = page.locator('[aria-label="Active layers"]');
    await expect(layers).toBeVisible();
    const box = (await layers.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(390 + 2);
    await expect(page.locator('select[aria-label="Base layer"]')).toBeVisible();
  });
});
