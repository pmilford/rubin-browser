/**
 * Base-layer auto-fallback OUTCOME tests (deterministic — no live network).
 *
 * Verifies the "Auto degrades to DSS2 without user action when Rubin fails" fix,
 * and the associated auth-host-gating fix (the Bearer token must NEVER be sent to
 * the public CDS host, or the DSS fallback would itself fail CORS). Rubin + DSS
 * hosts are intercepted with page.route so the test is bit-stable.
 */

import { test, expect, type Page, type Route } from '@playwright/test';

// 1x1 PNG, served for any stubbed tile so <img> onload fires. CORS header is
// required because tiles are requested with crossOrigin="anonymous".
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
);
const CORS = { 'access-control-allow-origin': '*' };

function stubImage(route: Route): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: PNG_1x1 });
}
const isTile = (url: string): boolean => /Norder\d+.*Npix\d+/.test(url);

async function injectToken(page: Page): Promise<void> {
  // A non-JWT token: present (→ authenticated) but with no parseable expiry.
  await page.addInitScript(() => {
    try { sessionStorage.setItem('rubin_rsp_token', 'fake-test-token'); } catch { /* ignore */ }
  });
}

test.describe('Base auto-fallback', () => {
  test('Auto + failing Rubin degrades to DSS2 automatically, with no token sent to CDS', async ({ page }) => {
    await injectToken(page);

    const dssAuthHeaders: (string | undefined)[] = [];
    let dssTileRequests = 0;
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('alasky.cds.unistra.fr') && isTile(url)) {
        dssTileRequests++;
        dssAuthHeaders.push(req.headers()['authorization']);
      }
    });

    // Rubin: everything 404s. DSS: serve stub tiles + a minimal properties file.
    await page.route('**/data.lsst.cloud/**', (route) => route.fulfill({ status: 404, body: 'no rights' }));
    await page.route('**/alasky.cds.unistra.fr/**', (route) => {
      const url = route.request().url();
      if (url.endsWith('/properties')) {
        return route.fulfill({ status: 200, contentType: 'text/plain', headers: CORS, body: 'hips_order=3\nhips_tile_format=jpeg\n' });
      }
      return stubImage(route);
    });

    await page.goto('/');

    // The viewer should switch to DSS on its own and say so — no user action.
    await expect(page.locator('.info-banner')).toContainText('DSS2', { timeout: 15000 });
    // It must actually request DSS tiles...
    await expect.poll(() => dssTileRequests, { timeout: 15000 }).toBeGreaterThan(0);
    // ...and NONE of those DSS requests may carry the Rubin Bearer token.
    expect(dssAuthHeaders.every((h) => !h)).toBe(true);
  });

  test('Explicit Rubin does NOT fall back — it shows the switch-layer error and stays on Rubin', async ({ page }) => {
    await injectToken(page);
    await page.route('**/data.lsst.cloud/**', (route) => route.fulfill({ status: 404, body: 'no rights' }));
    await page.route('**/alasky.cds.unistra.fr/**', (route) => {
      const url = route.request().url();
      if (url.endsWith('/properties')) {
        return route.fulfill({ status: 200, contentType: 'text/plain', headers: CORS, body: 'hips_order=3\nhips_tile_format=jpeg\n' });
      }
      return stubImage(route);
    });

    await page.goto('/');
    // Let the initial auto phase settle (it will have fallen back to DSS).
    await expect(page.locator('.info-banner')).toBeVisible({ timeout: 15000 });

    // Now the user explicitly selects Rubin — from here on, only Rubin tiles.
    const postSelectHosts: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (isTile(url)) postSelectHosts.push(url.includes('data.lsst.cloud') ? 'rubin' : 'dss');
    });
    await page.locator('select[aria-label="Base layer"]').selectOption('rubin');

    // The auto info banner must clear (explicit choice ≠ auto), and the red error
    // telling the user to switch must appear — no silent survey swap.
    await expect(page.locator('.info-banner')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('.error-overlay')).toContainText('Switch the Base layer', { timeout: 15000 });

    // Post-selection tile traffic goes to Rubin, never DSS.
    await expect.poll(() => postSelectHosts.length, { timeout: 10000 }).toBeGreaterThan(0);
    expect(postSelectHosts.includes('dss')).toBe(false);
  });
});
