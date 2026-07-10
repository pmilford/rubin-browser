/**
 * Offline demo OUTCOME test: selecting the "Offline demo (synthetic)" base layer
 * must render a non-black sky ENTIRELY from the bundled generator — zero tile
 * requests to any survey host — and must clearly label the data as synthetic.
 */

import { test, expect, type Page } from '@playwright/test';

const nonBlackFraction = (el: HTMLCanvasElement): number => {
  const ctx = el.getContext('2d')!;
  const d = ctx.getImageData(0, 0, el.width, el.height).data;
  let nb = 0, t = 0;
  for (let i = 0; i < d.length; i += 4 * 11) {
    if (d[i]! + d[i + 1]! + d[i + 2]! > 6) nb++;
    t++;
  }
  return nb / t;
};

test.describe('Offline demo mode', () => {
  test('renders synthetic tiles with no network + a SYNTHETIC banner', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForTimeout(800);

    // From here, record any HiPS tile requests to real survey hosts.
    let surveyTileRequests = 0;
    page.on('request', (req) => {
      const url = req.url();
      if (/Norder\d+.*Npix\d+/.test(url) && (url.includes('lsst.cloud') || url.includes('alasky') || url.startsWith('http'))) {
        surveyTileRequests++;
      }
    });

    await page.locator('select[aria-label="Base layer"]').selectOption('offline');

    // The synthetic-data banner must be shown (honesty: not a real survey).
    await expect(page.locator('.synthetic-banner')).toContainText('SYNTHETIC', { timeout: 8000 });

    // Canvas fills with locally-generated content.
    const canvas = page.locator('.hips-canvas').first();
    await expect.poll(async () => canvas.evaluate(nonBlackFraction), { timeout: 8000 }).toBeGreaterThan(0.3);

    // And it did so WITHOUT hitting any survey host.
    await page.waitForTimeout(500);
    expect(surveyTileRequests).toBe(0);
  });
});
