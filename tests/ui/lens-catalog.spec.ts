/**
 * Gravitational-lens overlay + linked-table OUTCOME test (feature 130).
 *
 * The catalog is BUNDLED (no network), so this asserts real outcomes, not existence:
 *   1. Toggling the layer lists a KNOWN lens name in the linked table.
 *   2. Clicking that lens's row selects it (aria-selected) AND recenters the view
 *      onto the lens's known RA/Dec (asserting the center MOVED there, not merely
 *      that some text changed).
 *   3. The gold lens markers actually PAINT on the canvas: gold pixels appear at
 *      the recentred marker and disappear when the layer is toggled off.
 * jsdom can't observe the canvas, so this must be a browser test.
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

async function readView(page: Page): Promise<{ ra: number; dec: number }> {
  const t = (await page.locator('[aria-label="Field of view indicator"]').textContent()) ?? '';
  const num = (re: RegExp): number => {
    const m = t.match(re);
    return m ? parseFloat(m[1]!) : NaN;
  };
  return { ra: num(/RA\s+([\d.]+)°/), dec: num(/Dec\s+(-?[\d.]+)°/) };
}

/** Count gold-ish (lens marker/label coloured) pixels in a central box of the canvas. */
async function centralGoldCount(page: Page): Promise<number> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const { width: w, height: h } = el;
    const bw = Math.min(220, w), bh = Math.min(160, h);
    const x0 = Math.floor(w / 2 - bw / 2), y0 = Math.floor(h / 2 - bh / 2);
    const d = ctx.getImageData(x0, y0, bw, bh).data;
    let gold = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
      // Gold marker (~255,190,60) / label (~255,214,140): strong R, mid G, low B.
      if (r > 180 && g > 120 && b < 140 && r > b + 60) gold++;
    }
    return gold;
  });
}

test('lens overlay lists a known lens, recenters on click, and paints gold markers', async ({ page }) => {
  await page.goto('/');
  await waitForTiles(page);

  const before = await readView(page);

  await page.locator('button[aria-label="Toggle gravitational lens catalog"]').click();

  const table = page.locator('[aria-label="Catalog table"]');
  await expect(table).toBeVisible();
  // A real, verified lens name from the bundled catalog.
  await expect(table.getByText('Einstein Cross (Q2237+0305)')).toBeVisible();

  // Click the Einstein Cross row (located by its name, not a brittle index).
  const row = table.locator('tr', { hasText: 'Einstein Cross' });
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');

  // The view recentres ONTO the lens's known J2000 position (340.126, +3.3585),
  // moving away from the default centre (~62, -37).
  await page.waitForTimeout(400);
  const after = await readView(page);
  expect(Math.abs(after.ra - 340.126)).toBeLessThan(0.5);
  expect(Math.abs(after.dec - 3.3585)).toBeLessThan(0.5);
  expect(Math.abs(after.ra - before.ra)).toBeGreaterThan(50); // genuinely moved

  // The gold lens marker + label paint at the (now centred) lens...
  const goldOn = await centralGoldCount(page);
  expect(goldOn).toBeGreaterThan(20);

  // ...and vanish when the layer is toggled off (proving the gold WAS the markers).
  await page.locator('button[aria-label="Toggle gravitational lens catalog"]').click();
  await page.waitForTimeout(400);
  const goldOff = await centralGoldCount(page);
  expect(goldOn - goldOff).toBeGreaterThan(15);
});
