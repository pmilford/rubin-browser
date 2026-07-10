/**
 * Coordinate-graticule OUTCOME test. The grid + compass + scale bar draw on the
 * main canvas ONLY when toggled on (default off, so the committed screenshot
 * baseline is unaffected). We assert the toggle actually PAINTS — the canvas
 * fingerprint changes when the grid is on and reverts when it is off — not merely
 * that a button flipped state. (Curvature/compass/scale correctness is covered by
 * the pure tests in tests/unit/graticule.test.ts.)
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForTiles(page: Page, quietMs = 900, hardCapMs = 12000): Promise<void> {
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

/** 8x8 grid of mean-RGB cells — a cheap canvas fingerprint. */
async function fingerprint(page: Page): Promise<number[]> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const { width: w, height: h } = el;
    const d = ctx.getImageData(0, 0, w, h).data;
    const N = 8;
    const out: number[] = [];
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = (gy * h) / N; y < ((gy + 1) * h) / N; y += 5) {
          for (let x = (gx * w) / N; x < ((gx + 1) * w) / N; x += 5) {
            const i = (Math.floor(y) * w + Math.floor(x)) * 4;
            r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; n++;
          }
        }
        out.push(r / n, g / n, b / n);
      }
    }
    return out;
  });
}

const l1 = (a: number[], b: number[]): number =>
  a.reduce((s, v, i) => s + Math.abs(v - (b[i] ?? 0)), 0);

test('toggling the coordinate grid paints (and clears) the overlay', async ({ page }) => {
  await page.goto('/');
  await waitForTiles(page);

  const before = await fingerprint(page);
  const toggle = page.locator('button[aria-label="Toggle coordinate grid"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(400);
  const on = await fingerprint(page);

  // The grid lines + compass + scale bar change the canvas across many cells.
  // A no-op toggle (grid never drawn) would leave the fingerprint unchanged.
  expect(l1(on, before)).toBeGreaterThan(20);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(400);
  const off = await fingerprint(page);

  // Turning it off removes the overlay → returns close to the original.
  expect(l1(off, before)).toBeLessThan(l1(on, before));
});
