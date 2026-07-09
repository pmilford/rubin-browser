/**
 * Ground-truth-free regression guard for the per-tile TEXTURE ORIENTATION.
 *
 * The geometry unit tests validate where each tile's quad is placed, but a tile
 * whose image is reflected/rotated about its diagonal still forms a valid quad —
 * that is the bug that shipped (M31 rendered as a per-tile zigzag). There is no
 * pixel-level "ground truth" for real DSS tiles, but there IS a convention-free
 * signal: a CORRECT tessellation of real sky is smooth across tile boundaries,
 * while a per-tile reflection injects sharp discontinuities exactly at the
 * (identically-placed) boundaries, raising the image's total variation.
 *
 * This test renders M31's structured core with the SHIPPED mapping and with a
 * deliberately reflected mapping (via the `window.__tileCorners` test seam in
 * ImageViewer) and asserts the shipped mapping is measurably smoother. It fails
 * if any reflected/rotated orientation is reintroduced.
 */

import { test, expect, type Page } from '@playwright/test';

async function settle(page: Page, ms = 3000): Promise<void> {
  await page.waitForTimeout(ms);
}

/** Mean total variation of luminance over the central region (lower = smoother). */
async function totalVariation(page: Page): Promise<number> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const { width: w, height: h } = el;
    const d = ctx.getImageData(0, 0, w, h).data;
    const lum = (i: number) => 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    const x0 = Math.floor(w * 0.2), x1 = Math.floor(w * 0.8);
    const y0 = Math.floor(h * 0.2), y1 = Math.floor(h * 0.8);
    let tv = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        tv += Math.abs(lum(i) - lum(i + 4)) + Math.abs(lum(i) - lum(i + w * 4));
        n++;
      }
    }
    return tv / n;
  });
}

async function reRenderAndMeasure(page: Page): Promise<number> {
  // Nudge zoom to force a re-render + tile reload with the current mapping.
  await page.locator('button[aria-label="Zoom out"]').click();
  await settle(page, 1500);
  await page.locator('button[aria-label="Zoom in"]').click();
  await settle(page, 3500);
  return totalVariation(page);
}

test('shipped tile orientation renders smoother than a reflected one (no per-tile flip)', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto('/');
  await settle(page, 3000);
  await page.locator('input[aria-label="Search coordinates"]').fill('10.6847, 41.269');
  await page.locator('button[aria-label="Go"]').click();
  await settle(page, 3000);
  for (let i = 0; i < 4; i++) {
    await page.locator('button[aria-label="Zoom in"]').click();
    await settle(page, 2000);
  }

  // Shipped mapping (no override).
  await page.evaluate(() => {
    delete (globalThis as unknown as { __tileCorners?: unknown }).__tileCorners;
  });
  const tvShipped = await reRenderAndMeasure(page);

  // Deliberately reflected mapping (the original buggy "NESW" reorder).
  await page.evaluate(() => {
    (globalThis as unknown as { __tileCorners?: number[][] }).__tileCorners = [
      [1, 1], [1, 0], [0, 0], [0, 1],
    ];
  });
  const tvReflected = await reRenderAndMeasure(page);

  // eslint-disable-next-line no-console
  console.log('tile-orientation TV', JSON.stringify({ tvShipped, tvReflected }));
  // The reflected tessellation is discontinuous at tile boundaries → higher TV.
  expect(tvShipped).toBeLessThan(tvReflected - 0.15);
});
