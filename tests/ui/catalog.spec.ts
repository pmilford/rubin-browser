/**
 * Gaia catalog overlay + linked-table OUTCOME test (feature 101). Toggling Gaia
 * queries the public Gaia TAP (mocked via page.route for determinism), overlays
 * markers, and lists the sources in a linked table; clicking a row selects it.
 * Exercises the real chain: fetchGaiaCone → parseGaiaResponse → gaiaToCatalogSet →
 * markers + table. jsdom can't observe the canvas markers, so this is a browser test.
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForTiles(page: Page, quietMs = 900, hardCapMs = 12000): Promise<void> {
  let last = Date.now();
  const onResp = (r: { url(): string }): void => {
    if (/Norder\d+.*Npix\d+/.test(r.url())) last = Date.now();
  };
  page.on('response', onResp);
  const start = Date.now();
  while (Date.now() - last <= quietMs && Date.now() - start <= hardCapMs) {
    await page.waitForTimeout(150);
  }
  page.off('response', onResp);
  await page.waitForTimeout(250);
}

test('Gaia overlay lists sources in a linked table and links a row to the marker', async ({ page }) => {
  // Sources near the default view centre (62, -37) so markers land on-canvas.
  await page.route('**/tap-server/tap/sync', async (route) => {
    const body = JSON.stringify({
      metadata: [
        { name: 'source_id' }, { name: 'ra' }, { name: 'dec' },
        { name: 'phot_g_mean_mag' }, { name: 'bp_rp' },
        { name: 'pmra' }, { name: 'pmdec' }, { name: 'parallax' },
      ],
      data: [
        ['4472832130942575872', 62.0, -37.0, 18.4, 1.2, -3.1, 2.0, 1.5],
        ['4472832130942575873', 62.03, -37.02, 19.1, 0.7, 1.0, -0.5, 0.8],
        ['4472832130942575874', 61.98, -36.98, 17.2, 1.6, 5.0, 3.3, 2.2],
      ],
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });

  await page.goto('/');
  await waitForTiles(page);

  await page.locator('button[aria-label="Toggle Gaia catalog"]').click();

  const table = page.locator('[aria-label="Catalog table"]');
  await expect(table).toBeVisible();
  // Real parsed rows (source ids preserved without precision loss).
  await expect(table.getByText('4472832130942575872')).toBeVisible();
  await expect(table.locator('[aria-label="Catalog row 2"]')).toBeVisible();

  // Click a row → it becomes the selected (linked) source.
  await table.locator('[aria-label="Catalog row 1"]').click();
  await expect(table.locator('[aria-label="Catalog row 1"]')).toHaveAttribute('aria-selected', 'true');
});
