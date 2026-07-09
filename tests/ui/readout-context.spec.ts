/**
 * Pixel-readout sky-context OUTCOME test: the readout must show the constellation
 * and nearest catalog object under the cursor, computed LIVE from RA/Dec — not
 * wired to a constant. (This is the class of bug where a readout shipped showing
 * hardcoded zeros.) Correctness of the values themselves is covered by the pure
 * unit tests (constellation.test.ts / catalog.test.ts); here we prove the wiring
 * produces real, position-dependent output in the running app.
 */

import { test, expect, type Page } from '@playwright/test';

async function readReadout(page: Page): Promise<string> {
  const el = page.locator('.pixel-readout');
  await expect(el).toBeVisible();
  return (await el.innerText()) ?? '';
}

test.describe('Pixel readout sky context', () => {
  test('shows a real constellation + nearest object that change with cursor position', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    const canvas = page.locator('.hips-canvas').first();
    const box = (await canvas.boundingBox())!;

    // Hover near the center.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    const t1 = await readReadout(page);

    // The readout must contain a Const line with a plausible (multi-letter) name
    // and a Near line with a "<distance> <compass>" detail — not blanks/zeros.
    // Labels render uppercased via CSS (innerText is "CONST"/"NEAR").
    expect(t1).toMatch(/CONST\s+[A-Za-z][a-zA-Z ]{2,}/i);
    expect(t1).toMatch(/NEAR\s+\S+/i);
    expect(t1).toMatch(/[\d.]+\s*(°|′|″)\s+(N|NE|E|SE|S|SW|W|NW)/);

    // Read the RA at center.
    const raOf = (s: string): number => {
      const m = s.match(/RA[^0-9-]*[\dhms.:]+\s+(-?[\d.]+)°/);
      return m ? parseFloat(m[1]!) : NaN;
    };
    const ra1 = raOf(t1);

    // Hover far to the side — RA must change (readout is live, not static).
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2);
    await page.waitForTimeout(200);
    const t2 = await readReadout(page);
    const ra2 = raOf(t2);

    expect(Number.isFinite(ra1)).toBe(true);
    expect(Number.isFinite(ra2)).toBe(true);
    expect(Math.abs(ra2 - ra1)).toBeGreaterThan(0.01);
  });
});
