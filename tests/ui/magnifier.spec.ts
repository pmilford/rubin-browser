/**
 * Magnifier-loupe OUTCOME test (feature 107). With the loupe on, moving the
 * cursor over the image must paint a MAGNIFIED copy of the pixels under the
 * cursor into the loupe canvas — not a blank circle, and it must TRACK the cursor
 * (a different region → different content). jsdom can't observe canvas→canvas
 * drawImage, so this is a browser test.
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

/** Mean brightness of the loupe canvas. */
async function loupeBrightness(page: Page): Promise<number> {
  return page.locator('[aria-label="Magnifier loupe"]').evaluate((el: HTMLCanvasElement) => {
    const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
    return s / (d.length / 4);
  });
}

test('the magnifier loupe shows magnified content that tracks the cursor', async ({ page }) => {
  await page.goto('/');
  await waitForTiles(page);

  await page.locator('button[aria-label="Toggle magnifier"]').click();
  const canvas = page.locator('.hips-canvas').first();
  const box = (await canvas.boundingBox())!;

  // Hover one region → the loupe fills with magnified pixels (not a blank circle).
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.45);
  await page.waitForTimeout(200);
  const loupe = page.locator('[aria-label="Magnifier loupe"]');
  await expect(loupe).toBeVisible();
  const a = await loupeBrightness(page);
  expect(a).toBeGreaterThan(2); // real content, not an all-black loupe

  // Move to a different region → the loupe content changes (it tracks the cursor,
  // it isn't a frozen/placeholder image).
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.7);
  await page.waitForTimeout(200);
  const b = await loupeBrightness(page);
  expect(Math.abs(b - a)).toBeGreaterThan(0.5);
});
