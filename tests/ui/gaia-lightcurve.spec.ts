/**
 * Gaia DR2 variable light-curve OUTCOME test (feature: Gaia epoch photometry).
 * The parser + endpoint are validated against real data elsewhere (the curl probe
 * + tests/regression/gaiaLightCurve.regression.test.ts); here we route the GAVO
 * dr2epochflux query to that VERBATIM live fixture and assert the UI WIRING: the
 * toggle fetches, the plot draws real epochs, and an empty result is honest.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const FIXTURE = readFileSync('tests/fixtures/gaia-dr2-epochflux.json', 'utf-8');
const EMPTY = JSON.stringify({ columns: JSON.parse(FIXTURE).columns, data: [] });

/** Route ONLY the dr2epochflux (light-curve) query; leave other GAVO calls alone. */
async function routeEpochFlux(page: Page, body: string): Promise<void> {
  await page.route('**/tap/sync', (route) => {
    const post = route.request().postData() ?? '';
    if (/dr2epochflux/i.test(decodeURIComponent(post))) {
      route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      route.continue();
    }
  });
}

test.describe('Gaia variable light curve', () => {
  test('toggle fetches epoch photometry and plots the real transits', async ({ page }) => {
    await routeEpochFlux(page, FIXTURE);
    await page.goto('/');

    await page.locator('button[aria-label="Toggle Gaia variable light curve"]').click();

    // The fixture has 19 finite G transits → the intensity-vs-time plot draws points.
    await expect
      .poll(() => page.locator('[aria-label="Intensity vs time"] circle').count(), { timeout: 15000 })
      .toBeGreaterThan(1);
    // Provenance names the DR2 source (not a fabricated panel).
    await expect(page.locator('.lc-plot')).toContainText(/Gaia DR2/i);
  });

  test('an empty cone is reported honestly, not as a blank/no-op panel', async ({ page }) => {
    await routeEpochFlux(page, EMPTY);
    await page.goto('/');
    await page.locator('button[aria-label="Toggle Gaia variable light curve"]').click();

    await expect(page.locator('[aria-label="Light curve status"]')).toContainText(
      /No Gaia DR2 variable here/i,
      { timeout: 15000 }
    );
  });
});
