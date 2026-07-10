/**
 * Distance-ruler OUTCOME test. Asserts that dragging in ruler mode (a) produces a
 * great-circle separation readout that GROWS with the drag extent (kills a
 * hardcoded/no-op readout), and (b) does NOT pan the sky (the ruler canvas steals
 * the drag — kills "measuring pans the view"). The great-circle math itself is
 * unit-tested in tests/unit/skyGeom.test.ts.
 */

import { test, expect, type Page } from '@playwright/test';

async function readCenter(page: Page): Promise<{ ra: number; dec: number }> {
  const t = (await page.locator('[aria-label="Field of view indicator"]').textContent()) ?? '';
  const num = (re: RegExp): number => {
    const m = t.match(re);
    return m ? parseFloat(m[1]!) : NaN;
  };
  return { ra: num(/RA\s+([\d.]+)°/), dec: num(/Dec\s+(-?[\d.]+)°/) };
}

/** Parse the ruler button's separation readout into arcseconds. */
async function readSepArcsec(page: Page): Promise<number> {
  const t = (await page.locator('button[aria-label="Toggle distance ruler"]').textContent()) ?? '';
  const m = t.match(/([\d.]+)\s*(°|′|″)/);
  if (!m) return NaN;
  const v = parseFloat(m[1]!);
  return m[2] === '°' ? v * 3600 : m[2] === '′' ? v * 60 : v;
}

async function drag(page: Page, box: { x: number; y: number; width: number; height: number },
  fx0: number, fy0: number, fx1: number, fy1: number): Promise<void> {
  await page.mouse.move(box.x + box.width * fx0, box.y + box.height * fy0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * fx1, box.y + box.height * fy1, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test('ruler measures a growing great-circle distance and does not pan', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(700);

  const before = await readCenter(page);
  await page.locator('button[aria-label="Toggle distance ruler"]').click();
  const canvas = page.locator('.hips-canvas').first();
  const box = (await canvas.boundingBox())!;

  // Short horizontal drag → small separation.
  await drag(page, box, 0.45, 0.5, 0.55, 0.5);
  const short = await readSepArcsec(page);

  // Longer horizontal drag → larger separation.
  await drag(page, box, 0.3, 0.5, 0.7, 0.5);
  const long = await readSepArcsec(page);

  expect(short).toBeGreaterThan(0);
  expect(long).toBeGreaterThan(short * 2); // ~4x the pixel extent → clearly larger

  // The sky center must be unchanged — measuring must not pan.
  const after = await readCenter(page);
  expect(Math.abs(after.ra - before.ra)).toBeLessThan(0.01);
  expect(Math.abs(after.dec - before.dec)).toBeLessThan(0.01);
});
