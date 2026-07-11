/**
 * DS9 region OUTCOME tests (feature 121). These assert PIXELS and BEHAVIOUR, not
 * existence:
 *  - drawing a circle in region mode actually PAINTS a green stroke on the region
 *    overlay (getImageData), and that stroke SURVIVES a pan and REPOSITIONS with
 *    the sky (a screen-pinned region would not move) — proving regions are stored
 *    in RA/Dec and reprojected, not fixed in screen space;
 *  - Export produces .reg text containing `circle(`;
 *  - Import of a pasted `fk5 / circle(...)` renders a new region.
 */

import { test, expect, type Page } from '@playwright/test';

/** Count green (region-stroke) pixels on the region overlay and their X centroid. */
async function greenStats(page: Page): Promise<{ count: number; cx: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.region-canvas') as HTMLCanvasElement | null;
    if (!canvas) return { count: 0, cx: NaN };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { count: 0, cx: NaN };
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let count = 0;
    let sumX = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const a = data[i + 3]!;
        if (a > 20 && g > 170 && g - r > 35 && g - b > 35) {
          count++;
          sumX += x;
        }
      }
    }
    return { count, cx: count ? sumX / count : NaN };
  });
}

async function readCenter(page: Page): Promise<{ ra: number; dec: number }> {
  const t = (await page.locator('[aria-label="Field of view indicator"]').textContent()) ?? '';
  const num = (re: RegExp): number => {
    const m = t.match(re);
    return m ? parseFloat(m[1]!) : NaN;
  };
  return { ra: num(/RA\s+([\d.]+)°/), dec: num(/Dec\s+(-?[\d.]+)°/) };
}

async function drawCircle(page: Page, box: { x: number; y: number; width: number; height: number },
  fx0: number, fy0: number, fx1: number, fy1: number): Promise<void> {
  await page.mouse.move(box.x + box.width * fx0, box.y + box.height * fy0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * fx1, box.y + box.height * fy1, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test('drawing a circle paints and the region survives + repositions on a pan', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(700);

  await page.locator('button[aria-label="Toggle region drawing"]').click();
  const canvas = page.locator('.hips-canvas').first();
  const box = (await canvas.boundingBox())!;

  // Draw a circle around the centre of the canvas.
  await drawCircle(page, box, 0.5, 0.5, 0.62, 0.5);

  const drawn = await greenStats(page);
  expect(drawn.count).toBeGreaterThan(20); // the stroke actually painted
  const cxBefore = drawn.cx;

  // Exit region mode so the pan drag reaches the tile canvas (not the overlay).
  await page.locator('button[aria-label="Toggle region drawing"]').click();
  const before = await readCenter(page);

  // Pan the sky to the right by ~120 px.
  const panDx = 120;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + panDx, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await readCenter(page);
  // The pan really happened (centre RA changed).
  expect(Math.abs(after.ra - before.ra)).toBeGreaterThan(0.001);

  const panned = await greenStats(page);
  // Region is STILL drawn after the pan (not cleared)…
  expect(panned.count).toBeGreaterThan(20);
  // …and it MOVED with the sky (a screen-pinned region would have the same cx).
  const shift = panned.cx - cxBefore;
  expect(shift).toBeGreaterThan(40); // moved right with the imagery, ~+panDx
});

test('Export yields DS9 text containing circle(', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(700);

  await page.locator('button[aria-label="Toggle region drawing"]').click();
  const canvas = page.locator('.hips-canvas').first();
  const box = (await canvas.boundingBox())!;
  await drawCircle(page, box, 0.5, 0.5, 0.6, 0.5);
  expect((await greenStats(page)).count).toBeGreaterThan(10);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('button[aria-label="Export regions as DS9 .reg file"]').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf-8');

  expect(text).toContain('# Region file format: DS9');
  expect(text).toContain('circle(');
});

test('Import of a pasted fk5 circle renders a region', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(700);

  // Build a circle at the CURRENT view centre so it is guaranteed on-screen.
  const center = await readCenter(page);
  const regText = `# Region file format: DS9\nfk5\ncircle(${center.ra.toFixed(4)},${center.dec.toFixed(4)},0.03)`;

  await page.locator('button[aria-label="Toggle region drawing"]').click();
  // Nothing drawn yet.
  expect((await greenStats(page)).count).toBe(0);

  await page.locator('button[aria-label="Import DS9 regions"]').click();
  await page.locator('textarea[aria-label="DS9 region text"]').fill(regText);
  await page.locator('button[aria-label="Parse pasted regions"]').click();
  await page.waitForTimeout(300);

  // A green region stroke now paints from the imported circle.
  expect((await greenStats(page)).count).toBeGreaterThan(20);
  // And the toolbar reflects the imported region.
  await expect(page.locator('button[aria-label="Toggle region drawing"]')).toContainText('(1)');
});
