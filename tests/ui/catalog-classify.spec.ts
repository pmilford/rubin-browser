/**
 * Catalog cross-match classifier wiring (TODO 151) — OUTCOME test.
 *
 * The pure luminance-morphology classifier can't tell a BRIGHT saturated star from a
 * galaxy (the independent-holdout overfit). The fix: when a click ALSO identifies a
 * typed bundled-catalog object at the cursor, that catalogue type OVERRIDES the
 * morphology call (catalogClassify.ts), and the inferred class then AGREES with the
 * "Identified: … (star)" panel instead of contradicting it.
 *
 * This drives the real click→identify+classify seam over Sirius (a bundled bright
 * star) and asserts the inferred class is "Star" decided by the CATALOG (the
 * "(catalog)" provenance mark) — a wiring that ignored the catalog, or left the raw
 * "(image-inferred)" morphology call, fails.
 */
import { test, expect } from '@playwright/test';

test('a bundled bright star is classified Star by the catalog cross-match, agreeing with the identify panel', async ({ page }) => {
  await page.goto('/');
  await page.locator('.hips-canvas').first().waitFor({ timeout: 10000 });
  // Offline base so a synthetic tile renders at Sirius's sky position (the catalog
  // identify is position-based and works on any base).
  await page.locator('select[aria-label="Base layer"]').selectOption('offline');
  await page.waitForTimeout(1000);

  // Centre on Sirius (bundled, RA 101.28722 Dec -16.71612), then zoom into the
  // classify window so the cutout has enough pixels.
  await page.locator('input[aria-label="Search coordinates"]').fill('101.28722, -16.71612');
  await page.locator('button[aria-label="Go"]').click();
  await page.waitForTimeout(1200);
  for (let i = 0; i < 3; i++) await page.locator('button[aria-label="Zoom in"]').click();
  await page.waitForTimeout(700);

  const canvas = page.locator('.hips-canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(700);

  // The bundled identify names Sirius…
  await expect(page.locator('[aria-label="Object name"]')).toContainText(/Sirius/i);
  // …and the inferred class is Star, decided by the CATALOG cross-match (not the raw
  // pixel morphology, which for a bright saturated star reads galaxy/uncertain).
  const cls = page.locator('[aria-label="Inferred class"]');
  await expect(cls).toContainText('Star');
  await expect(cls).toContainText('(catalog)');
});
