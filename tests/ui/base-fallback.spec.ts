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

    // Record the Rubin URLs actually requested, to assert the DP1 path.
    const rubinUrls: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('data.lsst.cloud')) rubinUrls.push(url);
    });

    await page.goto('/');

    // The viewer should switch to DSS on its own and say so — no user action.
    await expect(page.locator('.info-banner')).toContainText('DSS2', { timeout: 15000 });
    // The swallowed Rubin failure must be SURFACED (host + HTTP status), so a
    // wrong-path 404 can never again masquerade as "no data rights".
    await expect(page.locator('.info-banner')).toContainText('404', { timeout: 15000 });
    await expect(page.locator('.info-banner')).toContainText('data.lsst.cloud');
    // It must actually request DSS tiles...
    await expect.poll(() => dssTileRequests, { timeout: 15000 }).toBeGreaterThan(0);
    // ...and NONE of those DSS requests may carry the Rubin Bearer token.
    expect(dssAuthHeaders.every((h) => !h)).toBe(true);

    // Every Rubin request used the DP1 path — never the retired DP0.2 one.
    expect(rubinUrls.length).toBeGreaterThan(0);
    for (const u of rubinUrls) {
      expect(u).toContain('/api/hips/v2/dp1/deep_coadd/color_gri');
      expect(u).not.toContain('/api/hips/images/');
    }
  });

  test('DP1 Rubin renders: PNG tiles at the /v2/dp1/deep_coadd path, with the Bearer token', async ({ page }) => {
    await injectToken(page);

    const rubinTileReqs: { url: string; auth: string | undefined }[] = [];
    page.on('request', (req) => {
      const url = req.url();
      // Only the real GET tile fetches — not the CORS preflight OPTIONS (which
      // never carries Authorization).
      if (req.method() === 'GET' && url.includes('data.lsst.cloud') && isTile(url)) {
        rubinTileReqs.push({ url, auth: req.headers()['authorization'] });
      }
    });

    const AUTH_CORS = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization',
      'access-control-allow-methods': 'GET,OPTIONS',
    };
    // Serve the Rubin DP1 host: answer the CORS preflight (the authed fetch needs
    // it), 401 on /properties (auth-gated in reality), 200 PNG tiles at the correct
    // path. The viewer must NOT depend on /properties and must request .png.
    await page.route('**/data.lsst.cloud/**', (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: AUTH_CORS });
      const url = req.url();
      if (url.endsWith('/properties')) return route.fulfill({ status: 401, headers: AUTH_CORS, body: 'auth required' });
      if (isTile(url)) {
        // A solid-WHITE 8×8 PNG so a successful render is genuinely non-black.
        const white = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGP4jwMwDC0JALoev0Ewkwr8AAAAAElFTkSuQmCC',
          'base64',
        );
        return route.fulfill({ status: 200, contentType: 'image/png', headers: AUTH_CORS, body: white });
      }
      return route.fulfill({ status: 404, headers: AUTH_CORS, body: 'nope' });
    });

    await page.goto('/');
    // Explicitly select Rubin.
    await page.locator('select[aria-label="Base layer"]').selectOption('rubin');

    await expect.poll(() => rubinTileReqs.length, { timeout: 15000 }).toBeGreaterThan(0);
    for (const r of rubinTileReqs) {
      // Correct DP1 path...
      expect(r.url).toContain('/api/hips/v2/dp1/deep_coadd/color_gri');
      // ...requested as PNG (not the jpg default that 404'd every DP1 tile)...
      expect(r.url).toMatch(/\.png(\?|$)/);
      // ...and carrying the Bearer token (an <img> couldn't; the fetch→blob path does).
      expect(r.auth).toMatch(/^Bearer /);
    }
    // The canvas actually paints (tiles decoded, no wholesale failure).
    const canvas = page.locator('.hips-canvas').first();
    await expect.poll(async () => canvas.evaluate((el: HTMLCanvasElement) => {
      const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
      let nb = 0; for (let i = 0; i < d.length; i += 40) if (d[i]! + d[i + 1]! + d[i + 2]! > 6) nb++;
      return nb;
    }), { timeout: 15000 }).toBeGreaterThan(0);
  });

  test('Rubin multi-filter: switching the DP1 dataset changes the requested band path', async ({ page }) => {
    await injectToken(page);
    const white = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGP4jwMwDC0JALoev0Ewkwr8AAAAAElFTkSuQmCC',
      'base64',
    );
    const AUTH_CORS = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization',
      'access-control-allow-methods': 'GET,OPTIONS',
    };
    await page.route('**/data.lsst.cloud/**', (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: AUTH_CORS });
      if (isTile(req.url())) return route.fulfill({ status: 200, contentType: 'image/png', headers: AUTH_CORS, body: white });
      return route.fulfill({ status: 401, headers: AUTH_CORS, body: 'x' });
    });

    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('rubin');

    // Now record tile requests and switch the filter dataset to the r band.
    const gotBandR: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'GET' && /Norder\d+.*Npix\d+/.test(req.url()) && req.url().includes('/deep_coadd/band_r/')) {
        gotBandR.push(req.url());
      }
    });
    await page.locator('select[aria-label="Rubin DP1 dataset"]').selectOption('band_r');

    // Tiles must now come from the band_r dataset path (not color_gri).
    await expect.poll(() => gotBandR.length, { timeout: 15000 }).toBeGreaterThan(0);
    for (const u of gotBandR) expect(u).toContain('/api/hips/v2/dp1/deep_coadd/band_r/');
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
