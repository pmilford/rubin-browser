/**
 * Alert-source selector OUTCOME test. The overlay can be driven by the synthetic
 * demo set OR the real, auth-gated Rubin DP1 DIASource table. Unauthenticated (no
 * RSP token in these tests), selecting "Live DIA" must surface an honest sign-in
 * message and must NOT silently keep showing the synthetic data as if it were
 * real — the failure-mode-visibility rule. (The DIA ADQL/parse/fetch is unit-
 * tested in tests/unit/diaSource.test.ts.)
 */

import { test, expect } from '@playwright/test';

test('switching to Live DIA unauthenticated is honest and drops the demo data', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(600);

  // Enable alerts → the synthetic demo loads with a large count in the button.
  const toggle = page.locator('button[aria-label="Toggle alert overlay"]');
  await toggle.click();
  await expect(toggle).toContainText(/demo,\s*[\d,]+/);

  // Switch the source to Live DIA (no token in tests).
  await page.locator('select[aria-label="Alert source"]').selectOption('live');
  await page.waitForTimeout(400);

  // The synthetic count must be gone (no silent fake data presented as "DIA")...
  await expect(toggle).not.toContainText(/demo,/);
  // ...and the status bar tells the user a token is required.
  await expect(page.locator('.status-bar .message')).toContainText(/RSP token|sign in/i);
});
