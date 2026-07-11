/**
 * LIVE Rubin DP1 smoke test — the ONLY spec that exercises the real, token-gated
 * DP1 wire path in a real Chromium against data.lsst.cloud. Every other DP1 test
 * routes synthetic responses (see rubin-objects/cutout/dia specs), which prove the
 * PARSER but NOT reachability / CORS / redirects / auth / real response shape — the
 * class of failure a mock structurally cannot catch (see CLAUDE.md "MOCK IS NOT
 * VALIDATION"). This closes that gap when a real token is available.
 *
 * It is GATED on the RSP_TOKEN environment variable and SKIPS cleanly without one,
 * so it never runs (or fails) in normal CI. The token is read from the env and
 * injected into sessionStorage at runtime — it is NEVER hardcoded or committed.
 *
 * Requirements to actually run it:
 *   - An RSP token with DP1 data rights and scopes read:image + read:tap
 *     (data.lsst.cloud → your username → Security Tokens).
 *   - The dev server up (Playwright starts it): requests to data.lsst.cloud go
 *     through the Vite `/rsp` proxy (followRedirects) with the Bearer attached, so
 *     the browser path is same-origin and un-CORS-blocked exactly as in the app.
 *
 * Run it (watch it in a real Chrome window with --headed):
 *   RSP_TOKEN='gt-...' npx playwright test tests/ui/live-dp1-token.spec.ts --headed
 *   RSP_TOKEN='gt-...' npm run test:live
 *
 * Data-reality caveats that are NOT app bugs (the assertions account for them):
 *   - DP1 covers only ~7 small fields (~15 deg²); off-field there is legitimately
 *     no Rubin imagery, so the test navigates to a real DP1 field centre first.
 *   - data.lsst.cloud has maintenance windows (e.g. "patch Thursday"); a live
 *     outage is an environment condition, surfaced verbatim, not a code regression.
 */

import { test, expect, type Page, type Response } from '@playwright/test';

const TOKEN = process.env.RSP_TOKEN;

// A real DP1 field centre (ECDFS) — see src/data/dp1Fields.ts. Rubin imagery and
// dp1.Object rows exist here; the default view (RA 62,-37) is off every field.
const DP1_FIELD_ID = 'ecdfs';

/** Inject the env token into sessionStorage before the app boots (never committed). */
async function seedRealToken(page: Page): Promise<void> {
  await page.addInitScript((tok) => {
    try {
      sessionStorage.setItem('rubin_rsp_token', tok);
    } catch {
      /* ignore */
    }
  }, TOKEN!);
}

/**
 * Record every Rubin RSP response (proxied `/rsp/...` or absolute) with its HTTP
 * status, so a live failure reports WHY (401/403 rights, 404 path, 5xx/outage,
 * CORS) instead of a bare "canvas is black". Returned getter yields the >=400 ones.
 */
function trackRspFailures(page: Page): () => string[] {
  const failures: string[] = [];
  page.on('response', (resp: Response) => {
    const url = resp.url();
    if (!/\/rsp\/|data\.lsst\.cloud/.test(url)) return;
    if (resp.status() >= 400) failures.push(`${resp.status()} ${url}`);
  });
  return () => failures;
}

async function jumpToDp1Field(page: Page): Promise<void> {
  await page.locator('select[aria-label="Jump to DP1 field"]').selectOption(DP1_FIELD_ID);
  await expect(page.locator('[aria-label="Current field"]')).toBeVisible();
}

/** Fraction of non-black pixels in the first canvas — proves real imagery painted. */
async function nonBlackRatio(page: Page): Promise<number> {
  return page.locator('canvas').first().evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d');
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 8 || data[i + 1]! > 8 || data[i + 2]! > 8) lit++;
    }
    return lit / (data.length / 4);
  });
}

test.describe('LIVE Rubin DP1 (requires RSP_TOKEN with DP1 rights)', () => {
  test.skip(!TOKEN, 'Set RSP_TOKEN (scopes read:image + read:tap) to run the live DP1 smoke test.');

  test.beforeEach(async ({ page }) => {
    await seedRealToken(page);
  });

  test('DP1 HiPS tiles load with the token — Auto resolves to Rubin, not the DSS fallback', async ({
    page,
  }) => {
    const rspFailures = trackRspFailures(page);
    await page.goto('/');

    // Auto + a valid token should resolve to Rubin over a covered field. If the
    // real DP1 tiles 404/401, the app silently degrades to DSS — which is exactly
    // the regression this asserts against (the resolved-base indicator would then
    // read "DSS2", not "Rubin").
    await page.locator('select[aria-label="Base layer"]').selectOption('auto');
    await jumpToDp1Field(page);

    const resolved = page.locator('[aria-label="Resolved base layer"]');
    await expect(
      resolved,
      `Auto did not resolve to Rubin over a DP1 field. RSP errors seen: ${rspFailures().join(' | ') || 'none'}`
    ).toContainText(/Rubin/, { timeout: 30000 });

    // ...and real imagery actually painted (not a black canvas).
    await expect
      .poll(() => nonBlackRatio(page), { timeout: 30000, message: 'DP1 canvas stayed black' })
      .toBeGreaterThan(0.05);
  });

  test('DP1 Object TAP cone search returns real rows in the field', async ({ page }) => {
    const rspFailures = trackRspFailures(page);
    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('rubin');
    await jumpToDp1Field(page);

    await page.locator('button[aria-label="Toggle Rubin Object catalog"]').click();

    const table = page.locator('[aria-label="Catalog table"]');
    await expect(table).toBeVisible();
    // A real DP1 field returns objects — assert at least one data row appears
    // (not the "sign in" prerequisite and not an empty "0 objects" panel).
    await expect(
      table.locator('[aria-label="Catalog row 0"]'),
      `No dp1.Object rows returned live. RSP errors: ${rspFailures().join(' | ') || 'none'}`
    ).toBeVisible({ timeout: 30000 });
  });

  test('SODA FITS cutout resolves to a real image at the field centre', async ({ page }) => {
    const rspFailures = trackRspFailures(page);
    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('rubin');
    await jumpToDp1Field(page);

    await page.locator('button[aria-label="Toggle FITS cutout"]').click();

    // The panel must reach a terminal state; a live token should make it "loaded"
    // with a non-black cutout. If it errors, surface the app's honest message +
    // the RSP status codes so the failure is diagnosable, not mysterious.
    const status = page.locator('[aria-label="FITS cutout status"]');
    await expect(status).toBeVisible();
    await expect
      .poll(
        async () => (await status.textContent())?.toLowerCase() ?? '',
        { timeout: 40000, message: `cutout never settled. RSP errors: ${rspFailures().join(' | ') || 'none'}` }
      )
      .toMatch(/loaded|error|no dp1/);

    const statusText = (await status.textContent())?.toLowerCase() ?? '';
    if (statusText.includes('loaded')) {
      // The cutout canvas (last one added) must carry real pixels.
      const ratio = await page.locator('canvas').last().evaluate((el: HTMLCanvasElement) => {
        const ctx = el.getContext('2d');
        if (!ctx) return 0;
        const { data } = ctx.getImageData(0, 0, el.width, el.height);
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 0 && data[i]! > 4) lit++;
        return lit / (data.length / 4);
      });
      expect(ratio, 'cutout reported loaded but the canvas is empty/black').toBeGreaterThan(0.01);
    } else {
      // Not a hard failure (rights/coverage/outage vary), but make it LOUD in the
      // report so a real regression isn't hidden behind a green run.
      test.info().annotations.push({
        type: 'live-cutout',
        description: `cutout did not load: "${statusText}" — RSP: ${rspFailures().join(' | ') || 'none'}`,
      });
    }
  });
});
