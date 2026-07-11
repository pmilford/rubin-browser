/**
 * Gaia RICH-visualization OUTCOME test (colour-coded markers + linked colour–
 * magnitude diagram + proper-motion vectors).
 *
 * The overlay already fetches BP−RP colour / parallax / proper motion; this proves
 * they reach the PIXELS and the linked UI, not just the data layer:
 *   1. Markers are NOT all one colour — a hot (blue) source and a cool (red)
 *      source paint visibly different RGB on the canvas (a constant-colour
 *      renderer fails: we require both a strongly-blue AND a strongly-red marker).
 *   2. The colour–magnitude diagram shows one point per finite source (real data).
 *   3. Clicking a CMD point selects the SAME source the sky marker + table row
 *      share (aria-selected on the row) AND highlights the sky marker (a yellow
 *      selection ring appears at the recentred marker).
 *
 * A real 12′ Gaia cone is a tight cluster at the default wide FOV, so — like a
 * real user inspecting it — the test ZOOMS IN first to separate the markers. The
 * Gaia TAP query is routed for determinism (mirrors catalog.spec.ts), with sources
 * of DIFFERENT bp_rp (and well-separated positions) so colour is exercised.
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForTiles(page: Page, quietMs = 700, hardCapMs = 9000): Promise<void> {
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
  await page.waitForTimeout(200);
}

async function zoomIn(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.locator('button[aria-label="Zoom in"]').click();
    await page.waitForTimeout(200);
  }
  await waitForTiles(page);
}

/** Sample a canvas box → counts of strongly-blue, strongly-red, selection-yellow pixels. */
async function sampleBox(
  page: Page,
  x: number,
  y: number,
  bw: number,
  bh: number
): Promise<{ blue: number; red: number; yellow: number }> {
  return page.locator('.hips-canvas').first().evaluate(
    (el: HTMLCanvasElement, r0: { x: number; y: number; bw: number; bh: number }) => {
      const ctx = el.getContext('2d')!;
      const d = ctx.getImageData(r0.x, r0.y, r0.bw, r0.bh).data;
      let blue = 0, red = 0, yellow = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
        if (b > 150 && b > r + 70 && b > g + 70) blue++; // hot marker (~75,110,253)
        if (r > 150 && r > b + 70 && r > g + 70) red++; // cool marker (~253,84,67)
        if (r > 200 && g > 200 && b < 130) yellow++; // selection ring (#ff3)
      }
      return { blue, red, yellow };
    },
    { x, y, bw, bh }
  );
}

test('Gaia markers render in >1 colour, the CMD shows points, and CMD↔marker selection links', async ({ page }) => {
  // Sources near the default centre (62, -37), well separated in RA/Dec so they
  // don't overdraw each other once zoomed in: one HOT/blue (bp_rp 0.0) at centre,
  // one COOL/red (bp_rp 2.6) to the north, one with NO colour (NaN → grey) to the west.
  await page.route('**/dc.zah.uni-heidelberg.de/**', async (route) => {
    const body = JSON.stringify({
      columns: [
        { name: 'source_id' }, { name: 'ra' }, { name: 'dec' },
        { name: 'parallax' }, { name: 'pmra' }, { name: 'pmdec' },
        { name: 'phot_g_mean_mag' }, { name: 'bp_rp' },
      ],
      data: [
        // [source_id, ra, dec, parallax, pmra, pmdec, G, bp_rp]
        ['4472832130942575872', 62.0, -37.0, 10.0, 20.0, -15.0, 12.0, 0.0], // blue, plx>0, centre
        ['4472832130942575873', 62.0, -36.8, 5.0, -10.0, 8.0, 18.5, 2.6], // red, plx>0, north
        ['4472832130942575874', 61.8, -37.0, null, null, null, 16.0, null], // grey, no colour/plx, west
      ],
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });

  await page.goto('/');
  await waitForTiles(page);

  await page.locator('button[aria-label="Toggle Gaia catalog"]').click();

  // The linked table lists the real parsed rows.
  const table = page.locator('[aria-label="Catalog table"]');
  await expect(table).toBeVisible();
  await expect(table.getByText('4472832130942575872')).toBeVisible();

  // Zoom in so the tight cone spreads out (blue stays centred; red moves north).
  await zoomIn(page, 4);

  // (1) Markers are colour-coded: a blue marker at centre AND a red marker above it
  //     (a constant-colour renderer paints only ONE of these).
  const box = await page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => ({
    w: el.width, h: el.height,
  }));
  // Tall box from above centre down through centre: catches the northern red marker
  // and the central blue marker, but not the western grey one.
  const region = await sampleBox(page, Math.floor(box.w / 2 - 90), 40, 180, Math.floor(box.h / 2));
  expect(region.blue, 'a hot/blue Gaia marker should paint').toBeGreaterThan(3);
  expect(region.red, 'a cool/red Gaia marker should paint').toBeGreaterThan(3);

  // (2) The colour–magnitude diagram shows one point per finite source (2 of 3;
  //     the NaN-colour source is unplottable).
  const cmd = page.locator('[aria-label="Colour-magnitude diagram"]');
  await expect(cmd).toBeVisible();
  await expect(cmd.locator('circle')).toHaveCount(2);

  // (3) Clicking the CMD point for source index 1 selects the SAME source across
  //     the linked UI: the table row becomes aria-selected...
  await cmd.locator('circle[data-index="1"]').click();
  await expect(table.locator('[aria-label="Catalog row 1"]')).toHaveAttribute('aria-selected', 'true');

  // ...and the sky marker gets a yellow selection ring at the (recentred) marker centre.
  await page.waitForTimeout(500);
  const centre = await sampleBox(page, Math.floor(box.w / 2 - 30), Math.floor(box.h / 2 - 30), 60, 60);
  expect(centre.yellow, 'selected sky marker should show a yellow ring').toBeGreaterThan(5);
});

test('proper-motion vectors toggle draws arrows only when on', async ({ page }) => {
  await page.route('**/dc.zah.uni-heidelberg.de/**', async (route) => {
    const body = JSON.stringify({
      columns: [
        { name: 'source_id' }, { name: 'ra' }, { name: 'dec' },
        { name: 'parallax' }, { name: 'pmra' }, { name: 'pmdec' },
        { name: 'phot_g_mean_mag' }, { name: 'bp_rp' },
      ],
      data: [
        // Large proper motions so the arrows are unmistakable long white lines;
        // NON-white markers (blue/red) so any white pixel is unambiguously an arrow.
        ['1', 62.0, -37.0, 10.0, 60.0, 40.0, 12.0, 0.0],
        ['2', 62.0, -36.8, 8.0, -50.0, -35.0, 14.0, 2.6],
      ],
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });

  await page.goto('/');
  await waitForTiles(page);
  await page.locator('button[aria-label="Toggle Gaia catalog"]').click();
  await zoomIn(page, 3);

  /** Count near-white thin-line (arrow, ~255,255,255 @ 0.7α) pixels centrally. */
  const whiteLine = async (): Promise<number> =>
    page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext('2d')!;
      const { width: w, height: h } = el;
      const bw = Math.min(300, w), bh = Math.min(240, h);
      const x0 = Math.floor(w / 2 - bw / 2), y0 = Math.floor(h / 2 - bh / 2);
      const d = ctx.getImageData(x0, y0, bw, bh).data;
      let white = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
        if (r > 175 && g > 175 && b > 175) white++;
      }
      return white;
    });

  const off = await whiteLine();
  await page.locator('button[aria-label="Toggle Gaia proper-motion vectors"]').click();
  await page.waitForTimeout(500);
  const on = await whiteLine();
  // Turning PM vectors on adds white arrow pixels.
  expect(on - off).toBeGreaterThan(10);
});
