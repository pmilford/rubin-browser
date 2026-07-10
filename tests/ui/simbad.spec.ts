/**
 * SIMBAD "what's here?" OUTCOME test (feature 103). Right-clicking the sky must
 * fire a public SIMBAD cone query and surface the results in a panel. The SIMBAD
 * endpoint is mocked via page.route so the test is deterministic and offline (no
 * live CDS dependency), but it exercises the REAL wiring: contextmenu → canvasToSky
 * → onSkyContext → objectsNear → parse → SimbadPanel. jsdom can't drive a
 * right-click-on-canvas → fetch → panel chain, so this must be a browser test.
 */

import { test, expect } from '@playwright/test';

test('right-click queries SIMBAD and shows the named object', async ({ page }) => {
  await page.route('**/sim-tap/sync', async (route) => {
    // The parser maps columns by name; `sep` is in degrees (→ arcsec ×3600).
    const body = JSON.stringify({
      metadata: [
        { name: 'main_id' }, { name: 'ra' }, { name: 'dec' },
        { name: 'otype_txt' }, { name: 'sep' },
      ],
      data: [['M  31', 10.6847, 41.269, 'AGN', 3.2 / 3600]],
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });

  await page.goto('/');
  const canvas = page.locator('.hips-canvas').first();
  await canvas.waitFor({ state: 'visible' });

  await canvas.click({ button: 'right', position: { x: 400, y: 300 } });

  const panel = page.locator('[aria-label="SIMBAD results"]');
  await expect(panel).toBeVisible();
  // The REAL parsed object name is shown — not a placeholder, and not empty.
  await expect(panel.getByText('M  31')).toBeVisible();
  await expect(panel.getByText('AGN')).toBeVisible();
});
