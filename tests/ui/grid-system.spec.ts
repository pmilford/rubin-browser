/**
 * Coordinate-system grid wiring OUTCOME test (feature 105). With the grid on,
 * switching the System selector from equatorial to galactic must REPAINT a
 * different grid (the lines follow different curves) — not just relabel. We assert
 * the canvas fingerprint changes. Correctness of the iso-lines is pinned by
 * tests/unit/graticuleSystems.test.ts.
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

async function fingerprint(page: Page): Promise<number[]> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
    const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    const N = 8, w = el.width, h = el.height, out: number[] = [];
    for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = (gy * h) / N; y < ((gy + 1) * h) / N; y += 5)
        for (let x = (gx * w) / N; x < ((gx + 1) * w) / N; x += 5) {
          const i = (Math.floor(y) * w + Math.floor(x)) * 4;
          r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; n++;
        }
      out.push(r / n, g / n, b / n);
    }
    return out;
  });
}

const l1 = (a: number[], b: number[]): number =>
  a.reduce((s, v, i) => s + Math.abs(v - (b[i] ?? 0)), 0);

test('switching the grid coordinate system repaints a different grid', async ({ page }) => {
  await page.goto('/');
  await waitForTiles(page);

  await page.locator('button[aria-label="Toggle coordinate grid"]').click();
  await page.waitForTimeout(400);
  const equatorial = await fingerprint(page);

  await page.locator('select[aria-label="Grid coordinate system select"]').selectOption('galactic');
  await page.waitForTimeout(400);
  const galactic = await fingerprint(page);

  // Galactic lines follow different curves than equatorial → the canvas changes.
  expect(l1(galactic, equatorial)).toBeGreaterThan(8);
});
