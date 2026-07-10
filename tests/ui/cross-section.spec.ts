/**
 * Cross-section tool OUTCOME test. Proves the wiring produces a real, interactive
 * profile AND — the load-bearing correctness check — that dragging the line does
 * NOT pan the sky (the "finishing a line pans the sky" trap the design review
 * flagged). Sampling correctness itself is covered by tests/unit/crossSection.ts.
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForTiles(page: Page, quietMs = 1000, hardCapMs = 12000): Promise<void> {
  let last = Date.now();
  const onResp = (r: { url(): string }): void => {
    if (/Norder\d+.*Npix\d+/.test(r.url())) last = Date.now();
  };
  page.on('response', onResp);
  const start = Date.now();
  while (Date.now() - last <= quietMs && Date.now() - start <= hardCapMs) {
    await page.waitForTimeout(150);
  }
  page.off('response', onResp);
  await page.waitForTimeout(250);
}

async function readCenter(page: Page): Promise<{ ra: number; dec: number }> {
  const t = (await page.locator('[aria-label="Field of view indicator"]').textContent()) ?? '';
  const num = (re: RegExp): number => {
    const m = t.match(re);
    return m ? parseFloat(m[1]!) : NaN;
  };
  return { ra: num(/RA\s+([\d.]+)°/), dec: num(/Dec\s+(-?[\d.]+)°/) };
}

/** Min/max Y across an SVG path `d` string (y = every "x,y" pair's second number). */
function pathYRange(d: string): number {
  const ys: number[] = [];
  for (const m of d.matchAll(/[ML]([\d.]+),([\d.]+)/g)) ys.push(parseFloat(m[2]!));
  if (ys.length === 0) return 0;
  return Math.max(...ys) - Math.min(...ys);
}

test.describe('Cross-section tool', () => {
  test('profiles the image, is interactive, and does NOT pan the sky', async ({ page }) => {
    await page.goto('/');
    await waitForTiles(page);

    const centerBefore = await readCenter(page);

    // Enable the tool.
    await page.locator('button[aria-label="Toggle cross-section tool"]').click();
    const plot = page.locator('[aria-label="Cross-section profile"]');
    await expect(plot).toBeVisible();

    const canvas = page.locator('.hips-canvas').first();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Draw a fresh horizontal line across the (content-rich) center.
    await page.mouse.move(cx - box.width * 0.3, cy);
    await page.mouse.down();
    await page.mouse.move(cx + box.width * 0.3, cy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const pathLoc = page.locator('[aria-label="Intensity vs position"] path');
    await expect(pathLoc).toHaveCount(1);
    const dAfterDraw = (await pathLoc.getAttribute('d')) ?? '';
    expect(dAfterDraw.length).toBeGreaterThan(0);
    // Real content varies → the plotted trace has vertical extent (not a flat line).
    expect(pathYRange(dAfterDraw)).toBeGreaterThan(3);

    // PAN SUSPENDED: that drag must not have moved the sky center.
    const centerAfter = await readCenter(page);
    expect(centerAfter.ra).toBeCloseTo(centerBefore.ra, 2);
    expect(centerAfter.dec).toBeCloseTo(centerBefore.dec, 2);

    // Dragging an endpoint changes the profile (the plot is live/wired).
    await page.mouse.move(cx + box.width * 0.3, cy); // grab the far handle
    await page.mouse.down();
    await page.mouse.move(cx + box.width * 0.2, cy + box.height * 0.25, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const dAfterEndpointDrag = (await pathLoc.getAttribute('d')) ?? '';
    expect(dAfterEndpointDrag).not.toBe(dAfterDraw);

    // Log/linear toggle changes the mapped shape.
    await page.locator('button[aria-label="Toggle logarithmic intensity axis"]').click();
    await page.waitForTimeout(150);
    const dLog = (await pathLoc.getAttribute('d')) ?? '';
    expect(dLog).not.toBe(dAfterEndpointDrag);
  });
});
