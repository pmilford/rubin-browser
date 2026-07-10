/**
 * DP1 coverage-overlay OUTCOME test (feature 102). Toggling "DP1 coverage" shades
 * the Rubin field footprints on the main canvas. We seed the view onto the ECDFS
 * DP1 field (via the permalink hash) so a coverage disc is on-screen, then assert
 * the toggle actually PAINTS — the canvas fingerprint changes when coverage is on
 * and reverts when off — not merely that a button flipped. (The disc geometry /
 * point-on-boundary correctness is covered by tests/unit/footprint.test.ts.)
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

test('toggling DP1 coverage shades the on-field footprint (and clears it)', async ({ page }) => {
  // Seed the view onto the ECDFS DP1 field so a coverage disc is on-screen.
  await page.goto('/#ra=53.13&dec=-28.1&z=7');
  await waitForTiles(page);

  const before = await fingerprint(page);
  const toggle = page.locator('button[aria-label="Toggle DP1 coverage"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(400);
  const on = await fingerprint(page);

  // The green disc fill + outline + field label change many cells; a no-op toggle
  // (nothing drawn, or the field projected off-screen) would leave it unchanged.
  expect(l1(on, before)).toBeGreaterThan(15);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(400);
  const off = await fingerprint(page);
  expect(l1(off, before)).toBeLessThan(l1(on, before));
});
