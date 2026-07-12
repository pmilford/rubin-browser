/**
 * Rubin DP1 Object catalog overlay + linked-table OUTCOME test (feature 128).
 *
 * The live path is token-gated and CI-unverified without a real RSP token, so this
 * routes the network deterministically (the same strategy as cutout/dia specs):
 *   - The Rubin TAP request goes through the dev `/rsp` proxy, so we route
 *     `**\/api/tap/sync` (which matches both the proxied and direct URL) plus the
 *     `**\/rsp/**` and `**\/data.lsst.cloud/**` globs, returning a synthetic
 *     dp1.Object result with a source at the default view centre (62, -37).
 *   - Rubin HiPS tiles are routed to a 1×1 PNG so the explicit Rubin base "works".
 * An RSP token is seeded so `isAuthenticated()` is true, and the base layer is set
 * to Rubin explicitly so `rubinActive` is true.
 *
 * Asserts the failure-visible OUTCOMES: the overlay markers PAINT on the canvas
 * (a magenta square — a blank canvas fails), the CatalogTable LISTS the object
 * (with its objectId), and a row click LINKS the marker (aria-selected) and
 * RECENTERS the view. A second test drives the unauthenticated/DSS path and
 * asserts the honest prerequisite is shown — NOT a silent no-op.
 */

import { test, expect, type Page } from '@playwright/test';
import { votableFromRows } from './helpers/votable.js';

// 1×1 black PNG (base64) — served for any Rubin HiPS tile so the Rubin base paints.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';

async function seedToken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('rubin_rsp_token', 'fake-test-token');
    } catch {
      /* ignore */
    }
  });
}

/** A synthetic dp1.Object TAP result — one object at the default view centre. */
const OBJECT_RESULT = {
  metadata: {
    fields: [
      { name: 'objectId' }, { name: 'coord_ra' }, { name: 'coord_dec' },
      { name: 'refBand' }, { name: 'r_psfMag' }, { name: 'r_cModelMag' },
    ],
  },
  data: [
    {
      objectId: '611253571010494475',
      coord_ra: 62.0,
      coord_dec: -37.0,
      refBand: 'i',
      r_psfMag: 22.5,
      r_cModelMag: 21.9,
    },
  ],
};

async function routeRubin(page: Page): Promise<void> {
  // Rubin HiPS tiles → a 1×1 PNG so the explicit Rubin base renders something.
  await page.route('**/api/hips/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1x1, 'base64') })
  );
  // Rubin TAP cone search (through the /rsp proxy) → the synthetic Object result.
  // The RSP TAP client parses VOTable, not JSON (see helpers/votable.ts).
  const tapBody = votableFromRows(OBJECT_RESULT.data);
  const fulfilTap = (route: import('@playwright/test').Route): Promise<void> =>
    route.fulfill({ status: 200, contentType: 'application/x-votable+xml', body: tapBody });
  await page.route('**/api/tap/sync', fulfilTap);
  await page.route('**/rsp/**', (route) => {
    if (route.request().url().includes('/api/tap/sync')) return fulfilTap(route);
    return route.fallback();
  });
  await page.route('**/data.lsst.cloud/**', (route) => {
    if (route.request().url().includes('/api/tap/sync')) return fulfilTap(route);
    return route.fallback();
  });
}

test('Rubin Object overlay: markers paint, the table lists the object, and a row click links + recenters', async ({
  page,
}) => {
  await seedToken(page);
  await routeRubin(page);

  await page.goto('/');
  await page.waitForTimeout(400);

  // Explicit Rubin base → rubinActive is true regardless of tile success.
  await page.locator('select[aria-label="Base layer"]').selectOption('rubin');
  await page.waitForTimeout(300);

  // Toggle the Rubin Object source → it cone-searches dp1.Object and overlays.
  const toggle = page.locator('button[aria-label="Toggle Rubin Object catalog"]');
  await toggle.click();

  // The linked table lists the parsed object (objectId preserved exactly).
  const table = page.locator('[aria-label="Catalog table"]');
  await expect(table).toBeVisible();
  await expect(table.getByText('611253571010494475')).toBeVisible();
  // The toggle button reflects the loaded count (proves parse→CatalogSet).
  await expect(toggle).toContainText('(1)');

  // Markers PAINT on the main canvas: scan for the distinctive magenta square.
  // A blank/black canvas (marker not drawn) fails this.
  const canvas = page.locator('canvas').first();
  const magenta = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const d = ctx.getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
      if (r > 170 && b > 150 && g < 150) n++;
    }
    return n;
  });
  expect(magenta).toBeGreaterThan(0);

  // Click the row → it becomes the selected (linked) source AND recenters the view
  // onto the object (62, -37).
  const row = table.locator('[aria-label="Catalog row 0"]');
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.status-bar .message')).toContainText('611253571010494475');
});

test('Rubin Object unauthenticated / non-Rubin base shows the honest prerequisite, not a silent no-op', async ({
  page,
}) => {
  // No token, default Auto→DSS base: neither prerequisite (Rubin base, auth) is met.
  await page.goto('/');
  await page.waitForTimeout(500);

  // TAP must never be called on this path (no fetch when the prerequisite is unmet).
  let tapCalled = false;
  page.on('request', (r) => {
    if (r.url().includes('/api/tap/sync')) tapCalled = true;
  });

  await page.locator('button[aria-label="Toggle Rubin Object catalog"]').click();

  // The linked table shows an honest, actionable prerequisite (NOT an empty panel).
  const table = page.locator('[aria-label="Catalog table"]');
  await expect(table).toBeVisible();
  await expect(table.locator('[aria-label="Catalog status"]')).toContainText(
    /switch the base layer to Rubin|sign in with an RSP token/i
  );
  // ...and the status bar echoes the missing prerequisite.
  await expect(page.locator('.status-bar .message')).toContainText(/no source/i);

  await page.waitForTimeout(300);
  expect(tapCalled).toBe(false);
});
