/**
 * Rubin refExtendedness cross-match classification (recognizer fix) — OUTCOME test.
 *
 * The user's complaint: on a real Rubin field the luminance-morphology classifier
 * mis-calls obvious galaxies. The fix defers to Rubin's OWN star/galaxy flag
 * (`dp1.Object.refExtendedness`, 0=star/1=galaxy) via a live cone cross-match at the
 * click. This drives the real click→identify→fetchNearestRubinObject→classify seam:
 * it routes a dp1.Object at the view centre with refExtendedness=1 (galaxy) and
 * asserts (a) the cone query carrying `refExtendedness` actually FIRED (the wiring —
 * a disconnected impl never queries), and (b) the inferred class reads "Galaxy"
 * decided by the CATALOG cross-match, not the raw pixel morphology of the flat tile.
 *
 * The live dp1.Object response shape is token-gated / CI-unverified (no real RSP
 * token); this proves the SEAM against a routed response derived from the published
 * schema column name — run `npm run test:live` with a token to confirm the real path.
 */
import { test, expect, type Page } from '@playwright/test';
import { votableFromRows } from './helpers/votable.js';

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';

async function seedToken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('rubin_rsp_token', 'fake-test-token'); } catch { /* ignore */ }
  });
}

test('a Rubin object with refExtendedness=1 classifies as Galaxy via the cross-match at the click', async ({ page }) => {
  await seedToken(page);

  // A dp1.Object at the default view centre (62, -37), flagged EXTENDED (galaxy).
  const objectRows = [
    { objectId: '611253571010494475', coord_ra: 62.0, coord_dec: -37.0, refBand: 'i', r_cModelMag: 20.4, refExtendedness: 1 },
  ];
  const tapBody = votableFromRows(objectRows);

  const tapAdql: string[] = [];
  const fulfilTap = async (route: import('@playwright/test').Route): Promise<void> => {
    tapAdql.push(route.request().postData() ?? '');
    await route.fulfill({ status: 200, contentType: 'application/x-votable+xml', body: tapBody });
  };
  await page.route('**/api/hips/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1x1, 'base64') }),
  );
  await page.route('**/api/tap/sync', fulfilTap);
  await page.route('**/rsp/**', (route) => {
    if (route.request().url().includes('/api/tap/sync')) return fulfilTap(route);
    if (route.request().url().includes('/api/hips')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1x1, 'base64') });
    }
    return route.continue();
  });

  await page.goto('/');
  await page.locator('.hips-canvas').first().waitFor({ timeout: 10000 });
  // Explicit Rubin base so rubinActive is true (with the seeded token → authenticated).
  await page.locator('select[aria-label="Base layer"]').selectOption({ label: /Rubin/i }).catch(async () => {
    // Fallback: select by any option whose text contains "Rubin"/"DP1".
    const sel = page.locator('select[aria-label="Base layer"]');
    const opts = await sel.locator('option').allTextContents();
    const idx = opts.findIndex((t) => /rubin|dp1/i.test(t));
    if (idx >= 0) await sel.selectOption({ index: idx });
  });
  await page.waitForTimeout(1200);

  const canvas = page.locator('.hips-canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1200); // identify (debounced) + async cone cross-match

  // (a) The wiring fired: a dp1.Object cone query carrying refExtendedness went out.
  expect(tapAdql.some((q) => /dp1\.Object/i.test(q) && /refExtendedness/i.test(q))).toBe(true);

  // (b) The inferred class is Galaxy, decided by the catalog cross-match.
  const cls = page.locator('[aria-label="Inferred class"]');
  await expect(cls).toContainText('Galaxy');
  await expect(cls).toContainText('(catalog)');
});
