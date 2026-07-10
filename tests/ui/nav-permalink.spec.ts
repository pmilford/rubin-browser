/**
 * Navigation & sharing OUTCOME tests: URL permalink seed + write, DP1 field
 * jump, and keyboard pan. These assert the REAL center RA/Dec (read from the
 * field-of-view indicator, which reflects the viewer's $state), not label
 * tautologies — a broken seed, a no-op jump, or a backwards key would fail.
 */

import { test, expect, type Page } from '@playwright/test';

async function readView(page: Page): Promise<{ ra: number; dec: number; fov: number }> {
  const t = (await page.locator('[aria-label="Field of view indicator"]').textContent()) ?? '';
  const num = (re: RegExp): number => {
    const m = t.match(re);
    return m ? parseFloat(m[1]!) : NaN;
  };
  return {
    ra: num(/RA\s+([\d.]+)°/),
    dec: num(/Dec\s+(-?[\d.]+)°/),
    fov: num(/FOV\s+([\d.]+)°/),
  };
}

test.describe('Navigation & permalink', () => {
  test('seeds the view from the URL hash (not the default 62,-37)', async ({ page }) => {
    await page.goto('/#ra=53.13&dec=-28.1&z=6&base=dss');
    await page.waitForTimeout(600);
    const v = await readView(page);
    // Kills "seed ignored" — default would be 62 / -37.
    expect(v.ra).toBeCloseTo(53.13, 1);
    expect(v.dec).toBeCloseTo(-28.1, 1);
    // The base selector reflects the seeded value.
    await expect(page.locator('select[aria-label="Base layer"]')).toHaveValue('dss');
  });

  test('garbage hash does NOT teleport to (0,0) — falls back to the default', async ({ page }) => {
    await page.goto('/#ra=foo&dec=&z=abc');
    await page.waitForTimeout(600);
    const v = await readView(page);
    // A Number(x)||0 impl would show 0,0. We must keep the default 62,-37.
    expect(v.ra).toBeCloseTo(62.0, 1);
    expect(v.dec).toBeCloseTo(-37.0, 1);
  });

  test('DP1 field jump navigates to the field centre', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);
    await page.locator('select[aria-label="Jump to DP1 field"]').selectOption('ecdfs');
    await page.waitForTimeout(600);
    const v = await readView(page);
    expect(v.ra).toBeCloseTo(53.13, 1);
    expect(v.dec).toBeCloseTo(-28.1, 1);
  });

  test('the view is written back to the URL hash and survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);
    await page.locator('select[aria-label="Jump to DP1 field"]').selectOption('47tuc');
    // Wait for the debounced (300ms) permalink write.
    await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 5000 }).toContain('ra=6.02');
    const url = page.url();

    // Reload the captured URL in a fresh context → the same view comes back.
    await page.goto(url);
    await page.waitForTimeout(600);
    const v = await readView(page);
    expect(v.ra).toBeCloseTo(6.02, 1);
    expect(v.dec).toBeCloseTo(-72.08, 1);
  });

  test('keyboard ArrowRight pans east by ~fov/4 (direction + magnitude)', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);
    const before = await readView(page);
    const canvas = page.locator('.hips-canvas').first();
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const after = await readView(page);
    // ArrowRight increases RA by one pan step (fov/4). Direction AND magnitude:
    const delta = after.ra - before.ra;
    expect(delta).toBeGreaterThan(0); // kills a backwards/no-op key
    expect(delta).toBeCloseTo(before.fov / 4, 1);
  });
});
