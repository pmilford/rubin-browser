/**
 * 3D surface ("mountain") plot OUTCOME test. Proves the plot is wired to real
 * pixels: over a centred bright source the surface has a genuine peak (large
 * vertical spread), not a flat sheet. Surface geometry itself is unit-tested in
 * tests/unit/surfacePlot.test.ts.
 */

import { test, expect, type Page } from '@playwright/test';

/** Vertical spread (maxY − minY) of all polygon vertices in the surface svg. */
async function polyYSpread(page: Page): Promise<number> {
  return page.locator('svg[aria-label="Intensity surface"]').evaluate((svg: SVGElement) => {
    const polys = svg.querySelectorAll('polygon');
    let min = Infinity, max = -Infinity, n = 0;
    polys.forEach((p) => {
      const pts = (p.getAttribute('points') || '').trim().split(/\s+/);
      for (const pt of pts) {
        const y = parseFloat(pt.split(',')[1]!);
        if (Number.isFinite(y)) { min = Math.min(min, y); max = Math.max(max, y); n++; }
      }
    });
    return n === 0 ? -1 : max - min;
  });
}

test.describe('3D surface plot', () => {
  test('renders a peaked relief over a centred bright source (offline)', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);
    await page.locator('select[aria-label="Base layer"]').selectOption('offline');
    await expect(page.locator('.synthetic-banner')).toContainText('SYNTHETIC', { timeout: 8000 });

    // Centre the brightest synthetic transient at its peak epoch and zoom in.
    await page.locator('button[aria-label="Find a transient"]').click();
    await page.waitForTimeout(1300);

    // Enable the 3D surface.
    await page.locator('button[aria-label="Toggle 3D surface plot"]').click();
    await page.waitForTimeout(600);

    const svg = page.locator('svg[aria-label="Intensity surface"]');
    await expect(svg).toBeVisible();
    // It has a full mesh of cells (28×28 grid → 27×27 quads).
    await expect.poll(async () => svg.locator('polygon').count(), { timeout: 8000 }).toBeGreaterThan(100);

    // A centred bright source lifts the middle of the mesh well above the base:
    // the vertical spread of vertices is a large fraction of the 150px plot height.
    // A flat region (dead wiring / empty sky) would be nearly 0.
    await expect.poll(() => polyYSpread(page), { timeout: 8000 }).toBeGreaterThan(30);
  });

  test('the 3D toggle appears and hides the plot', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);
    const toggle = page.locator('button[aria-label="Toggle 3D surface plot"]');
    await expect(page.locator('svg[aria-label="Intensity surface"]')).toHaveCount(0);
    await toggle.click();
    await expect(page.locator('svg[aria-label="Intensity surface"]')).toBeVisible({ timeout: 8000 });
    await toggle.click();
    await expect(page.locator('svg[aria-label="Intensity surface"]')).toHaveCount(0);
  });

  test('light curve (offline only) plots the transient rising and fading over time', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);
    // Light-curve toggle only exists in offline mode.
    await expect(page.locator('button[aria-label="Toggle light curve"]')).toHaveCount(0);
    await page.locator('select[aria-label="Base layer"]').selectOption('offline');
    await expect(page.locator('.synthetic-banner')).toContainText('SYNTHETIC', { timeout: 8000 });

    // Centre the brightest transient at its peak, then show its light curve.
    await page.locator('button[aria-label="Find a transient"]').click();
    await page.waitForTimeout(1200);
    await page.locator('button[aria-label="Toggle light curve"]').click();

    const svg = page.locator('svg[aria-label="Intensity vs time"]');
    await expect(svg).toBeVisible({ timeout: 8000 });
    // The curve has a point per epoch and a real peak: the polyline's y-range is a
    // large fraction of the plot (a rise-and-fade), not a flat line.
    const yspread = await svg.evaluate((el: SVGElement) => {
      const d = el.querySelector('path')?.getAttribute('d') ?? '';
      const ys = [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => parseFloat(m[1]!));
      return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    });
    expect(yspread).toBeGreaterThan(20);
    // The current-epoch marker is drawn.
    await expect(svg.locator('[aria-label="Current epoch marker"]')).toBeVisible();
  });
});
