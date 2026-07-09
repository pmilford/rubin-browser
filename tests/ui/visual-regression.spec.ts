/**
 * Visual regression + quantitative seam/gap detection.
 *
 * The previous pixel test only asserted `percentNonBlack > 5` over the center
 * 200x200 — a warped, half-black, or diamond-seamed frame passed it. These
 * tests (a) pin a committed screenshot baseline and (b) measure the fraction of
 * uncovered "gap" pixels and thin dark seam-lines between tiles, so the
 * diamond-quilt artifact and any coverage hole fail quantitatively.
 *
 * Runs against the live dev server (Playwright auto-starts it) hitting public
 * DSS imagery. Determinism: fixed viewport (config), a tile-settle wait instead
 * of blind timeouts, masked dynamic HUD, and pinned sky regions.
 */

import { test, expect, type Page } from '@playwright/test';

/** Wait until HiPS tile responses have stopped arriving for `quietMs`. */
async function waitForTiles(page: Page, quietMs = 1200, hardCapMs = 15000): Promise<void> {
  let last = Date.now();
  const onResp = (r: { url(): string }): void => {
    if (/Norder\d+.*Npix\d+/.test(r.url())) last = Date.now();
  };
  page.on('response', onResp);
  const start = Date.now();
  for (;;) {
    await page.waitForTimeout(200);
    if (Date.now() - last > quietMs) break;
    if (Date.now() - start > hardCapMs) break;
  }
  page.off('response', onResp);
  // One more frame to let the RAF-debounced render flush.
  await page.waitForTimeout(300);
}

const MASKS = (page: Page) => [
  page.locator('[aria-label="Field of view indicator"]'),
  page.locator('[aria-label="Sky position minimap"]'),
];

test.describe('Visual regression + seam detection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForTiles(page);
  });

  test('canvas matches committed baseline (fixed region 62,-37 zoom 3)', async ({ page }) => {
    const canvas = page.locator('.hips-canvas').first();
    await expect(canvas).toHaveScreenshot('viewer-default.png', {
      mask: MASKS(page),
      maxDiffPixelRatio: 0.02, // tolerate JPEG/tile jitter, fail on structural change
      animations: 'disabled',
    });
  });

  test('no black seam/gap pixels between tiles', async ({ page }) => {
    const canvas = page.locator('.hips-canvas').first();
    const metric = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext('2d')!;
      const { width: w, height: h } = el;
      const data = ctx.getImageData(0, 0, w, h).data;
      // Inspect the central 70% (edges legitimately fall off the projected sphere).
      const x0 = Math.floor(w * 0.15), x1 = Math.floor(w * 0.85);
      const y0 = Math.floor(h * 0.15), y1 = Math.floor(h * 0.85);
      let pureBlack = 0, total = 0;
      // A HiPS/DSS sky background is dark blue/brown (sum ~15-60), never pure #000.
      // A gap/seam left by the tile mesh reads as sum <= 6 → distinguishable.
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * w + x) * 4;
          const sum = data[i]! + data[i + 1]! + data[i + 2]!;
          total++;
          if (sum <= 6) pureBlack++;
        }
      }
      // Seam-line detector: count pixels that are a sharp local dark minimum vs
      // their horizontal neighbours (a thin dark line = a tile seam).
      let seamPix = 0;
      for (let y = y0; y < y1; y += 3) {
        for (let x = x0 + 3; x < x1 - 3; x++) {
          const c = (y * w + x) * 4;
          const l = (y * w + (x - 3)) * 4;
          const r = (y * w + (x + 3)) * 4;
          const cs = data[c]! + data[c + 1]! + data[c + 2]!;
          const ls = data[l]! + data[l + 1]! + data[l + 2]!;
          const rs = data[r]! + data[r + 1]! + data[r + 2]!;
          if (cs + 40 < ls && cs + 40 < rs) seamPix++;
        }
      }
      return { pureBlackRatio: pureBlack / total, seamRatio: seamPix / total };
    });
    // eslint-disable-next-line no-console
    console.log('seam metric', JSON.stringify(metric));
    // No meaningful patch of the covered region may be an uncovered gap.
    expect(metric.pureBlackRatio).toBeLessThan(0.02);
    // Seam lines should be sparse; the diamond-quilt artifact spikes this count.
    expect(metric.seamRatio).toBeLessThan(0.01);
  });

  test('no black hole after navigating to a dense region', async ({ page }) => {
    await page.locator('input[aria-label="Search coordinates"]').fill('83.82, -5.39'); // Orion
    await page.locator('button[aria-label="Go"]').click();
    await waitForTiles(page);
    const canvas = page.locator('.hips-canvas').first();
    const nonBlackRatio = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext('2d')!;
      const { width: w, height: h } = el;
      const d = ctx.getImageData(0, 0, w, h).data;
      let nb = 0, t = 0;
      for (let i = 0; i < d.length; i += 4 * 7) {
        if (d[i]! + d[i + 1]! + d[i + 2]! > 6) nb++;
        t++;
      }
      return nb / t;
    });
    expect(nonBlackRatio).toBeGreaterThan(0.85);
  });
});
