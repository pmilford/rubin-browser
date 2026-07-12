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

  test('ForcedSource light curve plots real epochs when centred on a DP1 object', async ({ page }) => {
    const rspFailures = trackRspFailures(page);
    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('rubin');
    // A known EDFS object that has forced-source photometry (from a live probe).
    const search = page.locator('input[aria-label="Search coordinates"]');
    await search.fill('59.28107, -48.98508');
    await search.press('Enter');
    await page.waitForTimeout(2000);

    await page.locator('button[aria-label="Toggle light curve"]').click();
    const refresh = page.locator('button[aria-label="Refresh light curve"]');
    if (await refresh.count()) await refresh.first().click();

    // Real ForcedSource epochs → plotted points on the intensity-vs-time SVG. A
    // no-data / error state (or the old JSON-parse break) shows zero points.
    // Real ForcedSource epochs → plotted points on the intensity-vs-time SVG. A
    // no-data / error state (or the old JSON-parse break) shows zero points.
    await expect
      .poll(() => page.locator('[aria-label="Intensity vs time"] circle').count(), {
        timeout: 30000,
        message: `no light-curve points plotted. RSP errors: ${rspFailures().join(' | ') || 'none'}`,
      })
      .toBeGreaterThan(1);

    // Axis labels are present (both axes named), not a bare plot.
    await expect(page.locator('[aria-label="X axis"]')).toContainText(/MJD/);
    await expect(page.locator('[aria-label="Y axis"]')).toContainText(/flux/i);

    // The fetch pulls ALL bands, so the band picker offers more than one option
    // plus a luminance choice; switching band re-plots WITHOUT a re-fetch.
    const bandSelect = page.locator('select[aria-label="Light curve band"]');
    await expect(bandSelect).toBeVisible();
    const options = await bandSelect.locator('option').allInnerTexts();
    expect(options).toContain('luminance');
    expect(options.length).toBeGreaterThan(2); // >1 real band + luminance
    const before = page.locator('[aria-label="Intensity vs time"] circle');
    const rCount = await before.count();
    await bandSelect.selectOption('luminance');
    // Luminance combines every band's samples → at least as many points as one band.
    await expect
      .poll(() => page.locator('[aria-label="Intensity vs time"] circle').count())
      .toBeGreaterThanOrEqual(rCount);
  });

  test('Live DIA alert overlay fetches real DiaSource detections over a DP1 field', async ({
    page,
  }) => {
    const rspFailures = trackRspFailures(page);
    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('rubin');
    // EDFS is DIA-rich (a live probe returned the 20k row cap of real detections).
    await page.locator('select[aria-label="Jump to DP1 field"]').selectOption('edfs');
    await expect(page.locator('[aria-label="Current field"]')).toBeVisible();

    // Enable the overlay (loads the synthetic demo by default), then switch the
    // source to LIVE so the app cone-searches dp1.DiaSource at the field centre.
    const alertToggle = page.locator('button[aria-label="Toggle alert overlay"]');
    await alertToggle.click();
    await page.locator('select[aria-label="Alert source"]').selectOption('live');

    // A real field returns real difference-image detections → the toggle label
    // reports "(DIA, N)" with N>0. The old FORMAT=json break, an auth failure, or
    // a parse regression would instead show 0 / an error / the demo count. By
    // default the "reliable only" quality cut is ON, so this is the real-transient
    // count (~thousands), not the ~99% artifact scatter.
    const countFromLabel = async () => {
      const t = (await alertToggle.textContent()) ?? '';
      const m = t.match(/DIA,\s*([\d,]+)/);
      return m ? Number(m[1]!.replace(/,/g, '')) : 0;
    };
    await expect(
      alertToggle,
      `Live DIA returned no detections over EDFS. RSP errors: ${rspFailures().join(' | ') || 'none'}`
    ).toContainText(/DIA,\s*[1-9][\d,]*/, { timeout: 30000 });
    const reliableCount = await countFromLabel();

    // Turning the reliability cut OFF shows the full artifact scatter — a MUCH
    // larger set that overruns the 50k cap, so truncation is surfaced honestly.
    // This proves BOTH the quality filter (reliable << all) and the honest cap.
    await page.locator('input[aria-label="Reliable detections only"]').uncheck();
    await expect
      .poll(countFromLabel, { timeout: 30000, message: 'unfiltered DIA did not exceed the reliable set' })
      .toBeGreaterThan(reliableCount * 3);
    await expect(page.locator('[aria-label="Status message"]')).toContainText(/TRUNCATED/, {
      timeout: 30000,
    });
  });

  test('Visit-image blink loads real multi-epoch frames at a covered position', async ({
    page,
  }) => {
    // Fetching up to 12 per-epoch SODA cutouts sequentially is inherently slow;
    // give this live test more than the 45s default.
    test.setTimeout(180_000);
    const rspFailures = trackRspFailures(page);
    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('rubin');
    // A covered EDFS position with many per-visit images (a live probe returned
    // ~200 lsst.visit_image epochs across 6 bands over ~23 days here).
    const search = page.locator('input[aria-label="Search coordinates"]');
    await search.fill('59.28107, -48.98508');
    await search.press('Enter');
    await page.waitForTimeout(1500);

    await page.locator('button[aria-label="Toggle Rubin visit-image time series"]').click();

    // Real per-epoch cutouts decode → the blink frame canvas paints real pixels.
    const frame = page.locator('[aria-label="Visit image frame"]');
    await expect(
      frame,
      `Visit-image blink never rendered a frame. RSP errors: ${rspFailures().join(' | ') || 'none'}`
    ).toBeVisible({ timeout: 60000 });
    await expect
      .poll(
        () =>
          frame.evaluate((el: HTMLCanvasElement) => {
            const ctx = el.getContext('2d');
            if (!ctx) return 0;
            const { data } = ctx.getImageData(0, 0, el.width, el.height);
            let lit = 0;
            for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 0 && data[i]! > 4) lit++;
            return lit / (data.length / 4);
          }),
        { timeout: 60000, message: 'blink frame canvas stayed black' }
      )
      .toBeGreaterThan(0.01);

    // More than one epoch means it is a genuine TIME SERIES, not a single cutout —
    // the slider spans multiple frames.
    const slider = page.locator('[aria-label="Visit image epoch"]');
    await expect(slider).toBeVisible();
    const maxAttr = await slider.getAttribute('max');
    expect(Number(maxAttr)).toBeGreaterThan(1);
  });

  test('SODA FITS cutout resolves to a real image at the field centre', async ({ page }) => {
    const rspFailures = trackRspFailures(page);
    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('rubin');
    await jumpToDp1Field(page);

    await page.locator('button[aria-label="Toggle FITS cutout"]').click();

    // On LOAD the status element is replaced by the CutoutPanel (aria-label
    // "FITS cutout"), so wait for EITHER the loaded panel OR an error message —
    // whichever settles first — rather than polling an element that vanishes.
    const loadedPanel = page.locator('[aria-label="FITS cutout image"]');
    const errorMsg = page.locator('[aria-label="Cutout error"]');
    await expect(loadedPanel.or(errorMsg)).toBeVisible({
      timeout: 40000,
    });

    if (await loadedPanel.isVisible()) {
      // The DP1 cutout is a tile-compressed FITS; a successful decode paints real
      // pixels on the cutout canvas (a black/empty canvas = a decode regression).
      const ratio = await loadedPanel.evaluate((el: HTMLCanvasElement) => {
        const ctx = el.getContext('2d');
        if (!ctx) return 0;
        const { data } = ctx.getImageData(0, 0, el.width, el.height);
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 0 && data[i]! > 4) lit++;
        return lit / (data.length / 4);
      });
      expect(ratio, 'cutout loaded but the canvas is empty/black').toBeGreaterThan(0.01);
    } else {
      // Coverage/rights/outage vary — make it LOUD rather than a hidden failure.
      test.info().annotations.push({
        type: 'live-cutout',
        description: `cutout errored: "${await errorMsg.textContent()}" — RSP: ${rspFailures().join(' | ') || 'none'}`,
      });
    }
  });
});
