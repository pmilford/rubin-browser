/**
 * Centre reticle (feature 144) + light-curve target marker (feature 143) OUTCOME
 * tests. Both draw on the main HiPS canvas, so we assert real pixels on the OFFLINE
 * base (locally synthesised → readable getImageData, unlike cross-origin DSS):
 *  - the reticle toggle actually changes the pixels at the canvas centre;
 *  - showing a light curve paints the distinct orange target marker at the centre;
 *  - the marker is SKY-ANCHORED, not screen-pinned: with a Gaia curve fixed at a
 *    sky point, panning it off-canvas moves the orange out of the centre and turns
 *    it into an edge arrow — a screen-pinned (always-centre) or missing marker fails.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const GAIA_FIXTURE = readFileSync('tests/fixtures/gaia-dr2-epochflux.json', 'utf-8');
const CANVAS = 'canvas.hips-canvas';

async function goOffline(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('select[aria-label="Base layer"]').selectOption('offline');
  await page.waitForTimeout(900);
}

/** Route ONLY the Gaia dr2epochflux (light-curve) query to a fixture. */
async function routeEpochFlux(page: Page, body: string): Promise<void> {
  await page.route('**/tap/sync', (route) => {
    const post = decodeURIComponent(route.request().postData() ?? '');
    if (/dr2epochflux/i.test(post)) {
      route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      route.continue();
    }
  });
}

/**
 * Count "target-orange" (#ff8c1a ≈ 255,140,26) pixels of the main canvas in a
 * region. The offline base defaults to a grayscale colormap (r=g=b) and the reticle
 * is white/black, so neither can match this orange band — it is unique to the
 * feature-143 marker. region 'center' = a box around the centre; 'edge' = a border
 * band excluding that centre box.
 */
async function countOrange(page: Page, region: 'center' | 'edge'): Promise<number> {
  return page.locator(CANVAS).evaluate(
    (el: HTMLCanvasElement, region: 'center' | 'edge') => {
      const ctx = el.getContext('2d');
      if (!ctx) return -1;
      const w = el.width;
      const h = el.height;
      const { data } = ctx.getImageData(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const R = 120;
      const M = 70;
      let n = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const inCenter = Math.abs(x - cx) <= R && Math.abs(y - cy) <= R;
          const inEdge = x < M || x > w - M || y < M || y > h - M;
          const want = region === 'center' ? inCenter : inEdge && !inCenter;
          if (!want) continue;
          const i = (y * w + x) * 4;
          const r = data[i]!;
          const g = data[i + 1]!;
          const b = data[i + 2]!;
          if (r > 180 && g > 80 && g < 190 && b < 110) n++;
        }
      }
      return n;
    },
    region
  );
}

/** Sum of R+G+B over a small box at the canvas centre — a fingerprint that changes
 *  when the centre reticle is drawn/removed. */
async function centreFingerprint(page: Page): Promise<number> {
  return page.locator(CANVAS).evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d');
    if (!ctx) return -1;
    const w = el.width;
    const h = el.height;
    const box = 24;
    const { data } = ctx.getImageData(
      Math.round(w / 2 - box),
      Math.round(h / 2 - box),
      box * 2,
      box * 2
    );
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i]! + data[i + 1]! + data[i + 2]!;
    return sum;
  });
}

test.describe('Centre reticle (144)', () => {
  test('is on by default and toggling it changes the centre pixels', async ({ page }) => {
    await goOffline(page);
    const toggle = page.locator('button[aria-label="Toggle centre reticle"]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    const withReticle = await centreFingerprint(page);
    await toggle.click();
    await page.waitForTimeout(300);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const withoutReticle = await centreFingerprint(page);

    // The reticle is a real mark at the centre, not a no-op: removing it changes the
    // centre pixels. (A reticle that never drew would leave the fingerprint equal.)
    expect(Math.abs(withReticle - withoutReticle)).toBeGreaterThan(40);
  });
});

test.describe('Light-curve target marker (143)', () => {
  test('showing a light curve paints the orange target marker at the centre', async ({ page }) => {
    await goOffline(page);
    // No curve yet → no orange marker.
    expect(await countOrange(page, 'center')).toBeLessThan(6);

    await page.locator('button[aria-label="Toggle light curve"]').click();
    await page.waitForTimeout(700);

    // Offline curve is at the view centre → the orange ring+arrow marker appears.
    expect(await countOrange(page, 'center')).toBeGreaterThan(25);
  });

  test('the marker is sky-anchored: panning a fixed curve off-canvas yields an edge arrow', async ({
    page,
  }) => {
    await routeEpochFlux(page, GAIA_FIXTURE);
    await goOffline(page);

    await page.locator('button[aria-label="Toggle Gaia variable light curve"]').click();
    // Wait until the curve has drawn (its target sky point is now fixed at centre).
    await expect
      .poll(() => page.locator('[aria-label="Intensity vs time"] circle').count(), { timeout: 15000 })
      .toBeGreaterThan(1);
    await page.waitForTimeout(300);

    // Marker sits at the centre (the fetch position).
    expect(await countOrange(page, 'center')).toBeGreaterThan(12);
    expect(await countOrange(page, 'edge')).toBeLessThan(8);

    // Pan hard so the FIXED sky target leaves the canvas.
    const box = (await page.locator(CANVAS).boundingBox())!;
    const dx = Math.round(box.width * 0.9);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - dx, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Sky-anchored: the marker left the centre and became an edge arrow. A
    // screen-pinned (always-centre) marker would keep the centre orange and fail;
    // a marker that vanished off-canvas would leave the edge empty and fail.
    expect(await countOrange(page, 'center')).toBeLessThan(8);
    expect(await countOrange(page, 'edge')).toBeGreaterThan(8);
  });
});
