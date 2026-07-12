/**
 * Click-identify marker OUTCOME test (UX: "when I click, show me on the image what
 * I clicked, with a label").
 *
 * Before this, clicking an object opened the info panel in the corner but left NO
 * on-canvas indication of WHERE the click landed or WHAT it is. This drives the real
 * click seam on the offline cube and asserts a labelled marker (a near-white ring +
 * caption) is PAINTED at the click — a no-op (panel-only) impl paints nothing new.
 * The centre reticle is turned OFF first so the only near-white pixels near the click
 * come from the identify marker, not the reticle.
 */
import { test, expect, type Page } from '@playwright/test';

/** Count near-white pixels in a window centred on the canvas centre. */
async function nearWhiteAtCentre(page: Page, half = 34): Promise<number> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement, h: number) => {
    const ctx = el.getContext('2d')!;
    const cx = Math.floor(el.width / 2), cy = Math.floor(el.height / 2);
    const x0 = Math.max(0, cx - h), y0 = Math.max(0, cy - h);
    const d = ctx.getImageData(x0, y0, h * 2, h * 2).data;
    let white = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! > 200 && d[i + 1]! > 200 && d[i + 2]! > 200) white++;
    }
    return white;
  }, half);
}

test('clicking paints a labelled identify marker at the click point', async ({ page }) => {
  await page.goto('/');
  await page.locator('.hips-canvas').first().waitFor({ timeout: 10000 });
  await page.locator('select[aria-label="Base layer"]').selectOption('offline');
  await page.waitForTimeout(1200);
  // Go to a dark empty region (away from the injected galaxy@150,20 / star@150,22) so
  // the near-white marker stands out against the dark synthetic sky.
  await page.locator('input[aria-label="Search coordinates"]').fill('120, -10');
  await page.locator('button[aria-label="Go"]').click();
  await page.waitForTimeout(1000);
  // Reticle OFF so its white crosshair doesn't contribute to the near-white count.
  await page.locator('button[aria-label="Toggle centre reticle"]').click();
  await page.waitForTimeout(300);

  const before = await nearWhiteAtCentre(page);

  const canvas = page.locator('.hips-canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600); // identify fires immediately; class fills in shortly

  const after = await nearWhiteAtCentre(page);
  // The marker ring (r≈9.5px) + caption add clearly-detectable near-white pixels.
  expect(after - before).toBeGreaterThan(25);

  // And it is sky-anchored: dragging the view moves the marker off the centre, so the
  // near-white count at the CENTRE drops back down (a screen-pinned marker would not).
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 90, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const afterPan = await nearWhiteAtCentre(page);
  expect(afterPan).toBeLessThan(after);
});
