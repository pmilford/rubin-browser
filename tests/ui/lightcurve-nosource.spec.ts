/**
 * The light-curve toggle must never silently "do nothing" (user-reported). On
 * the default DSS base (no token, no offline cube) there is no epoch source, so
 * clicking it must surface an explicit "unavailable + why" panel rather than an
 * empty no-op. Deterministic: no network needed (the prerequisite path is local).
 */
import { test, expect } from '@playwright/test';

test('light-curve toggle explains the prerequisite instead of doing nothing', async ({ page }) => {
  await page.goto('/');

  const toggle = page.locator('button[aria-label="Toggle light curve"]');
  await expect(toggle).toBeVisible(); // always present now (was hidden on DSS)

  await toggle.click();

  const panel = page.locator('[aria-label="Light curve unavailable"]');
  await expect(panel).toBeVisible();
  // Names an actionable prerequisite, not a blank panel.
  await expect(panel).toContainText(/Rubin \(DP1\)|Offline demo|RSP token/);
});
