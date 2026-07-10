/**
 * Offline image-differencing wiring OUTCOME test (feature 108). Selecting the
 * offline base and toggling Diff must open the DiffPanel, jump to the synthetic
 * transient, and report at least one detected transient — the full
 * button → panel → real pipeline chain. Correctness of the detection itself is
 * pinned by tests/unit/offlineDiff.test.ts (ground truth).
 */

import { test, expect } from '@playwright/test';

test('offline Diff opens the panel and detects the synthetic transient', async ({ page }) => {
  await page.goto('/');
  // Switch to the offline synthetic base (no network, deterministic).
  await page.locator('select[aria-label="Base layer"]').selectOption('offline');
  await page.waitForTimeout(500);

  await page.locator('button[aria-label="Toggle image differencing"]').click();

  const panel = page.locator('[aria-label="Image differencing"]');
  await expect(panel).toBeVisible();

  // The known transient is detected (count > 0), not a blank/placeholder panel.
  await page.waitForTimeout(400);
  const countText = (await panel.locator('[aria-label="Transient count"]').textContent()) ?? '';
  expect(parseInt(countText, 10)).toBeGreaterThan(0);
  // The difference canvas exists and is the third frame (B − A).
  await expect(panel.locator('[aria-label="Difference frame"]')).toBeVisible();
});
