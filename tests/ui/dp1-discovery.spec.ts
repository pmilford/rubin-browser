/**
 * TODO 129 — DP1 dataset discovery OUTCOME test (Playwright, real browser).
 *
 * The Filter dropdown's datasets are DISCOVERED at runtime from the DP1 HiPS list
 * endpoint (`/api/hips/v2/dp1/list`), with the hardcoded RUBIN_DATASETS as a
 * graceful fallback. Under `vite dev`, that request is proxy-rewritten to the
 * same-origin `/rsp/...` path (toRequestUrl), so we route BOTH the absolute and
 * the proxied path.
 *
 * These assert OUTCOMES, not existence:
 *   1. Discovery success: a fixture whose SET differs from the hardcoded list
 *      (it adds `color_gr`, which is NOT hardcoded, and omits the hardcoded
 *      `color_izy`) makes the dropdown show `color_gr` and DROP `color_izy` — a
 *      viewer that ignored discovery and rendered the hardcoded list would still
 *      show `color_izy` and never `color_gr`, so it would FAIL here.
 *   2. Discovery failure (404): the dropdown falls back to the hardcoded list
 *      (shows `color_izy`, never the discovery-only `color_gr`), stays populated,
 *      and is still switchable to another band.
 */

import { test, expect, type Page, type Route } from '@playwright/test';

// White 8×8 PNG so any stubbed Rubin tile decodes to a non-black pixel.
const WHITE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGP4jwMwDC0JALoev0Ewkwr8AAAAAElFTkSuQmCC',
  'base64',
);
const AUTH_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization',
  'access-control-allow-methods': 'GET,OPTIONS',
};

// A real-SHAPED HiPS multi-record list body whose dataset SET deliberately
// differs from the hardcoded fallback: color_gri (kept so the default renders),
// color_gr (NOT in the fallback → a discovery-only marker), band_r.
const DISCOVERY_BODY = [
  'creator_did              = ivo://org.rubinobs/lsst-dp1?hips=color_gri&type=deep_coadd',
  'obs_title                = LSSTComCam: DP1 gri',
  'hips_tile_format         = png',
  'hips_order               = 11',
  'hips_service_url         = https://data.lsst.cloud/api/hips/v2/dp1/deep_coadd/color_gri',
  'dataproduct_subtype      = color',
  '',
  'creator_did              = ivo://org.rubinobs/lsst-dp1?hips=color_gr&type=deep_coadd',
  'obs_title                = LSSTComCam: DP1 gr',
  'hips_service_url         = https://data.lsst.cloud/api/hips/v2/dp1/deep_coadd/color_gr',
  'dataproduct_subtype      = color',
  '',
  'creator_did              = ivo://org.rubinobs/lsst-dp1?hips=band_r&type=deep_coadd',
  'obs_title                = LSSTComCam: DP1 r',
  'hips_service_url         = https://data.lsst.cloud/api/hips/v2/dp1/deep_coadd/band_r',
  'dataproduct_subtype      = color',
  '',
].join('\n');

const isTile = (url: string): boolean => /Norder\d+.*Npix\d+/.test(url);

async function injectToken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('rubin_rsp_token', 'fake-test-token'); } catch { /* ignore */ }
  });
}

/** Stub Rubin tiles (white PNG) + CORS preflight; other Rubin paths → 401. */
async function routeRubinTiles(page: Page): Promise<void> {
  const handler = (route: Route): Promise<void> => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: AUTH_CORS });
    if (isTile(req.url())) {
      return route.fulfill({ status: 200, contentType: 'image/png', headers: AUTH_CORS, body: WHITE_PNG });
    }
    return route.fulfill({ status: 401, headers: AUTH_CORS, body: 'auth required' });
  };
  // Cover both dev-proxied (localhost/rsp/...) and direct (data.lsst.cloud) tiles.
  await page.route(/Norder\d+.*Npix\d+/, handler);
}

/** The option `value`s currently in the Rubin DP1 dataset dropdown. */
async function datasetOptionValues(page: Page): Promise<string[]> {
  return page
    .locator('select[aria-label="Rubin DP1 dataset"] option')
    .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
}

test.describe('DP1 dataset discovery', () => {
  test('discovers datasets from the list endpoint and reflects them in the Filter dropdown', async ({ page }) => {
    await injectToken(page);
    await routeRubinTiles(page);

    let listRequests = 0;
    const serveList = (route: Route): Promise<void> => {
      listRequests++;
      return route.fulfill({ status: 200, contentType: 'text/plain', headers: AUTH_CORS, body: DISCOVERY_BODY });
    };
    // Route BOTH the proxied dev path and the absolute endpoint.
    await page.route('**/rsp/api/hips/v2/dp1/list', serveList);
    await page.route('**/api/hips/v2/dp1/list', serveList);

    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('rubin');

    const select = page.locator('select[aria-label="Rubin DP1 dataset"]');
    await expect(select).toBeVisible();

    // The list endpoint was actually hit...
    await expect.poll(() => listRequests, { timeout: 15000 }).toBeGreaterThan(0);
    // ...and the dropdown converges on the DISCOVERED set: the discovery-only
    // `color_gr` appears (a hardcoded-only viewer never would).
    await expect.poll(() => datasetOptionValues(page), { timeout: 15000 }).toContain('color_gr');

    const values = await datasetOptionValues(page);
    expect(values).toContain('color_gri'); // default, kept
    expect(values).toContain('band_r');
    // The hardcoded-only `color_izy` was REPLACED by discovery, proving the
    // dropdown reflects the endpoint, not the compiled-in constant.
    expect(values).not.toContain('color_izy');
  });

  test('falls back to the hardcoded datasets when discovery 404s (still populated + switchable)', async ({ page }) => {
    await injectToken(page);
    await routeRubinTiles(page);

    let listRequests = 0;
    const serve404 = (route: Route): Promise<void> => {
      listRequests++;
      return route.fulfill({ status: 404, headers: AUTH_CORS, body: 'not found' });
    };
    await page.route('**/rsp/api/hips/v2/dp1/list', serve404);
    await page.route('**/api/hips/v2/dp1/list', serve404);

    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('rubin');

    const select = page.locator('select[aria-label="Rubin DP1 dataset"]');
    await expect(select).toBeVisible();

    // Discovery was attempted and failed...
    await expect.poll(() => listRequests, { timeout: 15000 }).toBeGreaterThan(0);

    // ...so the dropdown shows the HARDCODED fallback: never empty, includes the
    // fallback-only `color_izy`, and never the discovery-only `color_gr`.
    await expect.poll(() => datasetOptionValues(page), { timeout: 15000 }).toContain('color_izy');
    const values = await datasetOptionValues(page);
    expect(values.length).toBeGreaterThanOrEqual(11);
    expect(values).not.toContain('color_gr');

    // The dropdown still works: switch to the r band.
    await select.selectOption('band_r');
    await expect(select).toHaveValue('band_r');
  });
});
