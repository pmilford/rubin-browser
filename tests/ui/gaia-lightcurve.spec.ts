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

  test('overlays g/bp/rp, legend toggles a band, hover reads out MJD, expand enlarges', async ({ page }) => {
    await routeEpochFlux(page, FIXTURE);
    await page.goto('/');
    await page.locator('button[aria-label="Toggle Gaia variable light curve"]').click();

    // Overlay: the fixture carries g/bp/rp, so three data-band series draw at once.
    const groups = page.locator('[aria-label="Intensity vs time"] g.series[data-band]');
    await expect.poll(() => groups.count(), { timeout: 15000 }).toBe(3);
    await expect(page.locator('g.series[data-band="bp"]')).toBeVisible();

    // Expand grows the plot SVG (re-projects into more pixels).
    const svg = page.locator('svg[aria-label="Intensity vs time"]');
    const wBefore = Number(await svg.getAttribute('width'));
    await page.locator('button[aria-label="Expand light curve"]').click();
    const wAfter = Number(await svg.getAttribute('width'));
    expect(wAfter).toBeGreaterThan(wBefore);

    // Hover a data point → the read-out reports a concrete MJD (not a static string).
    await page.locator('g.series[data-band="g"] circle').first().hover({ force: true });
    await expect(page.locator('[aria-label="Light curve readout"]')).toContainText(/MJD\s+\d/);

    // Legend toggle removes the bp series but keeps the others.
    await page.locator('button[aria-label="Toggle band bp"]').click();
    await expect(page.locator('g.series[data-band="bp"]')).toHaveCount(0);
    await expect(page.locator('g.series[data-band="g"]')).toHaveCount(1);
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
