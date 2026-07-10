/**
 * Click-to-identify OUTCOME tests. Proves the panel shows the RIGHT object's type
 * + brightness (not hardcoded/tautological), that a click identifies while a drag
 * still pans (gesture disambiguation), and that empty sky is reported honestly
 * rather than passing a far star off as "here".
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
  await page.waitForTimeout(200);
}

async function goTo(page: Page, coords: string): Promise<void> {
  const input = page.locator('input[aria-label="Search coordinates"]');
  await input.fill(coords);
  await input.press('Enter');
  await waitForTiles(page);
}

async function clickCentre(page: Page): Promise<void> {
  const canvas = page.locator('.hips-canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400); // identify is debounced ~220ms
}

async function readCentre(page: Page): Promise<{ ra: number; dec: number }> {
  const t = (await page.locator('[aria-label="Field of view indicator"]').textContent()) ?? '';
  const num = (re: RegExp): number => { const m = t.match(re); return m ? parseFloat(m[1]!) : NaN; };
  return { ra: num(/RA\s+([\d.]+)°/), dec: num(/Dec\s+(-?[\d.]+)°/) };
}

test.describe('Click-to-identify', () => {
  test('shows the clicked object type + magnitude, and changes for a different object', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await waitForTiles(page);

    // Canopus (a bright, ISOLATED star, mag −0.62) → click centre identifies it.
    // (Isolated objects avoid a denser neighbour winning the nearest-match.)
    await goTo(page, '95.99, -52.70');
    await clickCentre(page);
    const panel = page.locator('[aria-label="Object identification"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[aria-label="Object type"]')).toHaveText('Star');
    const canopusMag = await panel.locator('[aria-label="Object magnitude"]').textContent();
    expect(canopusMag).toMatch(/mag\s+-0\.6/);

    // ω Cen (NGC 5139, a GLOBULAR CLUSTER, mag 3.9) → the panel must change type+mag.
    await goTo(page, '201.69, -47.48');
    await clickCentre(page);
    await expect(panel.locator('[aria-label="Object type"]')).toHaveText('Globular cluster');
    const omegaCenMag = await panel.locator('[aria-label="Object magnitude"]').textContent();
    expect(omegaCenMag).toMatch(/mag\s+3\.9/);
    // Two different objects → two different type/magnitude strings (kills a
    // hardcoded/tautological panel).
    expect(omegaCenMag).not.toBe(canopusMag);
  });

  test('a click identifies without panning; a drag pans without identifying', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await waitForTiles(page);
    await goTo(page, '83.82, -5.39');

    const canvas = page.locator('.hips-canvas').first();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const panel = page.locator('[aria-label="Object identification"]');

    // A drag pans (center RA changes) and must NOT open the identify panel.
    const before = await readCentre(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy, { steps: 8 });
    await page.mouse.up();
    await waitForTiles(page);
    const after = await readCentre(page);
    expect(Math.abs(after.ra - before.ra)).toBeGreaterThan(0.1); // it panned
    await expect(panel).toHaveCount(0); // no identify panel from a drag

    // A bare click identifies and does NOT move the center.
    const c1 = await readCentre(page);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(400);
    await expect(panel).toBeVisible();
    const c2 = await readCentre(page);
    expect(c2.ra).toBeCloseTo(c1.ra, 2);
    expect(c2.dec).toBeCloseTo(c1.dec, 2);
  });

  test('empty sky is reported honestly, not as a far star', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await waitForTiles(page);
    // A deliberately empty region (RA 200, Dec -30) at high zoom → tiny match radius.
    await goTo(page, '200, -30');
    await page.locator('button[aria-label="Zoom in"]').click();
    await page.locator('button[aria-label="Zoom in"]').click();
    await waitForTiles(page);
    await clickCentre(page);

    const panel = page.locator('[aria-label="Object identification"]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('No catalogued object here');
    // It must NOT present a matched object's type field.
    await expect(panel.locator('[aria-label="Object type"]')).toHaveCount(0);
    // Provenance is labelled (local catalog, not a live Rubin query).
    await expect(panel).toContainText('Local bright-object catalog');
  });
});
