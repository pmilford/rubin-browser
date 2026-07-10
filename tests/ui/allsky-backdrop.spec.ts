/**
 * Allsky backdrop OUTCOME test. For a NETWORK base, a low-order full-sky set is
 * prefetched and pinned so the ancestor-preview always has a coarse image — no
 * black flash when jumping to an unvisited region while sharp tiles stream in.
 * (Offline mode is excluded on purpose: local synth needs no backdrop and it would
 * jank blinking.) Deterministic via page.route serving white tiles.
 */

import { test, expect, type Page } from '@playwright/test';

const WHITE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGP4jwMwDC0JALoev0Ewkwr8AAAAAElFTkSuQmCC',
  'base64',
);
const CORS = { 'access-control-allow-origin': '*' };

test.describe('Allsky backdrop (network base)', () => {
  test('prefetches the low-order full-sky tiles and paints a non-black backdrop', async ({ page }: { page: Page }) => {
    const order1Reqs = new Set<string>();
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('alasky') && /Norder1\/.*Npix\d+/.test(u)) order1Reqs.add(u);
    });

    // Serve DSS: order-1 (allsky) + all tiles as white PNGs; properties minimal.
    await page.route('**/alasky.cds.unistra.fr/**', (route) => {
      const url = route.request().url();
      if (url.endsWith('/properties')) {
        return route.fulfill({ status: 200, contentType: 'text/plain', headers: CORS, body: 'hips_order=9\nhips_tile_format=jpeg\n' });
      }
      return route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: WHITE_PNG });
    });

    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('dss');

    // The allsky backdrop prefetch issues a full sweep of order-1 tiles (48 cover
    // the sky). Assert a substantial fraction is requested — proof the backdrop is
    // actually prefetched, not just the handful of order-1 tiles in the view.
    await expect.poll(() => order1Reqs.size, { timeout: 15000 }).toBeGreaterThan(24);

    // Jump to a far region; the pinned backdrop keeps the canvas non-black.
    await page.locator('input[aria-label="Search coordinates"]').fill('280, 40');
    await page.locator('input[aria-label="Search coordinates"]').press('Enter');
    await page.waitForTimeout(400);
    const nonBlack = await page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
      const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
      let nb = 0, t = 0;
      for (let i = 0; i < d.length; i += 44) { if (d[i]! + d[i + 1]! + d[i + 2]! > 6) nb++; t++; }
      return nb / t;
    });
    expect(nonBlack).toBeGreaterThan(0.3);
  });
});
