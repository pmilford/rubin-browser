/**
 * Off-thread tile decode (TODO 125) OUTCOME test.
 *
 * The tile decode path moved from a main-thread `<img>` (`img.src = url;
 * img.onload`) to `fetch → blob → createImageBitmap` (network layers) and
 * `createImageBitmap(ImageData)` (offline), caching an `ImageBitmap`. This spec
 * PROVES, in a real browser (never a mock):
 *   1. the off-thread createImageBitmap path is ACTUALLY taken (not silently
 *      falling back to main-thread <img> decode) — via the `__tileDecodeCounts`
 *      seam the component increments only when a real decode is cached;
 *   2. the resulting canvas is NOT CORS-tainted — `getImageData` succeeds (it
 *      THROWS on a tainted canvas), which is the single failure mode that would
 *      silently break the post-processing pipeline, cross-section, and readout;
 *   3. the decoded tiles actually paint (a non-black sky).
 *
 * Both the public DSS (fetch→blob→bitmap) and the offline (ImageData→bitmap)
 * paths are exercised, because they are the two distinct decode routes.
 */

import { test, expect, type Page } from '@playwright/test';

/** { nonBlack: fraction of sampled pixels that are not ~pure black, readable: getImageData did not throw }. */
function readCanvas(el: HTMLCanvasElement): { nonBlack: number; readable: boolean } {
  const ctx = el.getContext('2d')!;
  let data: Uint8ClampedArray;
  try {
    // THROWS (SecurityError) if the canvas is tainted by a non-CORS tile — the
    // exact break we are guarding against. Catching it makes the taint visible.
    data = ctx.getImageData(0, 0, el.width, el.height).data;
  } catch {
    return { nonBlack: 0, readable: false };
  }
  let nb = 0, t = 0;
  for (let i = 0; i < data.length; i += 4 * 11) {
    if (data[i]! + data[i + 1]! + data[i + 2]! > 6) nb++;
    t++;
  }
  return { nonBlack: nb / t, readable: true };
}

const bitmapDecodes = (p: Page): Promise<number> =>
  p.evaluate(() => (window as unknown as { __tileDecodeCounts?: { bitmap: number } }).__tileDecodeCounts?.bitmap ?? 0);

/** Wait until HiPS tile responses have gone quiet, then let the RAF render flush. */
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
  await page.waitForTimeout(400);
}

test.describe('Off-thread tile decode (createImageBitmap)', () => {
  test('public DSS: tiles decode off-thread AND the canvas is NOT tainted (getImageData works)', async ({ page }) => {
    await page.goto('/');
    await waitForTiles(page);

    // The off-thread createImageBitmap path was actually taken — not a silent
    // main-thread <img> fallback for every tile.
    expect(await bitmapDecodes(page)).toBeGreaterThan(0);

    // The canvas remains readable (untainted) and painted: the failure mode we
    // must not introduce is a tainted canvas that makes getImageData throw.
    const canvas = page.locator('.hips-canvas').first();
    const r = await canvas.evaluate(readCanvas);
    expect(r.readable).toBe(true); // NOT CORS-tainted
    expect(r.nonBlack).toBeGreaterThan(0.5); // real imagery painted
  });

  test('cross-section reads pixels after the switch (getImageData-dependent feature still works)', async ({ page }) => {
    await page.goto('/');
    await waitForTiles(page);
    // Enable the cross-section tool and drag a line — it samples getImageData on a
    // scratch canvas the tiles are drawn to; a tainted tile would break it silently
    // (the component would show the "cross-origin protected" error-overlay instead
    // of a profile).
    await page.locator('button[aria-label="Toggle cross-section tool"]').click();
    const canvas = page.locator('.hips-canvas').first();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - box.width * 0.3, cy);
    await page.mouse.down();
    await page.mouse.move(cx + box.width * 0.3, cy, { steps: 8 });
    await page.mouse.up();
    // A real (non-tainted) readback produces a profile path with finite geometry.
    const pathLoc = page.locator('[aria-label="Intensity vs position"] path');
    await expect(pathLoc.first()).toBeVisible();
    const d = (await pathLoc.first().getAttribute('d')) ?? '';
    expect(d.length).toBeGreaterThan(20);
    expect(d).not.toContain('NaN');
    // And no cross-origin-taint error was raised.
    await expect(page.locator('.error-overlay')).toHaveCount(0);
  });

  test('offline: synthetic tiles decode via createImageBitmap(ImageData), untainted + non-black', async ({ page }) => {
    await page.goto('/#ra=62&dec=-37&z=4&base=offline');
    await page.waitForTimeout(2500);
    // Offline tiles are decoded from raw RGBA straight to an ImageBitmap — the
    // bitmap counter must climb even with zero network.
    expect(await bitmapDecodes(page)).toBeGreaterThan(0);
    const canvas = page.locator('.hips-canvas').first();
    const r = await canvas.evaluate(readCanvas);
    expect(r.readable).toBe(true);
    expect(r.nonBlack).toBeGreaterThan(0.3);
  });
});
