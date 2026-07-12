/**
 * 3D surface plot OUTCOME test. The surface is now a TEMPORAL WATERFALL of the
 * cross-section line (col = position along the line, row = epoch/time), so it is
 * meaningful only over the OFFLINE multi-epoch cube with a line drawn. These
 * prove: (a) over a transient it renders a real, non-flat mesh; (b) with no
 * offline layer it shows the honest empty prompt, not a fabricated surface.
 * The pure position×time grid is unit-tested in tests/unit/crossSection.test.ts.
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

/** Drag a line across the canvas centre so the cross-section (and thus surface) samples content. */
async function drawLine(page: Page, dxFrac: number, dyFrac: number): Promise<void> {
  const canvas = page.locator('.hips-canvas').first();
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - box.width * dxFrac, cy - box.height * dyFrac);
  await page.mouse.down();
  await page.mouse.move(cx + box.width * dxFrac, cy + box.height * dyFrac, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

test.describe('3D surface plot', () => {
  test('renders a non-flat waterfall of the line over epochs (offline)', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);
    await page.locator('select[aria-label="Base layer"]').selectOption('offline');
    await expect(page.locator('.synthetic-banner')).toContainText('SYNTHETIC', { timeout: 8000 });

    // Centre the brightest synthetic transient at its peak epoch and zoom in.
    await page.locator('button[aria-label="Find a transient"]').click();
    await page.waitForTimeout(1300);

    // Enable the 3D surface (this also enables the cross-section tool, seeding a line).
    await page.locator('button[aria-label="Toggle 3D surface plot"]').click();
    await page.waitForTimeout(400);
    // Draw a line across the transient so the waterfall samples real signal.
    await drawLine(page, 0.3, 0);

    const svg = page.locator('svg[aria-label="Intensity surface"]');
    await expect(svg).toBeVisible();
    // Full mesh: 12 epochs × 48 positions → 11×47 quads.
    await expect.poll(async () => svg.locator('polygon').count(), { timeout: 8000 }).toBeGreaterThan(100);

    // The transient rises and fades across the epoch rows, so the surface has real
    // vertical relief — a flat sheet (dead wiring / empty sky) would be ≈0.
    await expect.poll(() => polyYSpread(page), { timeout: 8000 }).toBeGreaterThan(30);
  });

  test('non-offline base shows the honest empty prompt, not a fabricated surface', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);
    const toggle = page.locator('button[aria-label="Toggle 3D surface plot"]');
    const region = page.locator('[aria-label="3D surface plot"]');
    const svg = page.locator('svg[aria-label="Intensity surface"]');

    await expect(region).toHaveCount(0);
    await toggle.click();
    // The panel appears, but there is NO rendered surface — only the honest prompt.
    await expect(region).toBeVisible({ timeout: 8000 });
    await expect(svg).toHaveCount(0);
    await expect(region).toContainText('Offline');
    await toggle.click();
    await expect(region).toHaveCount(0);
  });

  test('light curve (offline only) plots the transient rising and fading over time', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);
    await page.locator('select[aria-label="Base layer"]').selectOption('offline');
    await expect(page.locator('.synthetic-banner')).toContainText('SYNTHETIC', { timeout: 8000 });

    // Centre the brightest transient at its peak, then show its light curve.
    await page.locator('button[aria-label="Find a transient"]').click();
    await page.waitForTimeout(1200);
    await page.locator('button[aria-label="Toggle light curve"]').click();

    const svg = page.locator('svg[aria-label="Intensity vs time"]');
    await expect(svg).toBeVisible({ timeout: 8000 });
    // The curve has a point per epoch and a real peak: the y-range spanned by the
    // per-epoch markers is a large fraction of the plot (a rise-and-fade), not flat.
    // (The plot draws per-segment <line>s + per-point <circle>s, not one <path>.)
    const yspread = await svg.evaluate((el: SVGElement) => {
      const ys = [...el.querySelectorAll('g.series circle')].map((c) => parseFloat(c.getAttribute('cy') ?? 'NaN'));
      return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    });
    expect(yspread).toBeGreaterThan(20);
    // The current-epoch marker is drawn (a zero-width vertical <line>, so assert
    // presence — Playwright's visibility heuristic rejects an empty bounding box).
    await expect(svg.locator('[aria-label="Current epoch marker"]')).toHaveCount(1);
  });
});
