/**
 * Interaction OUTCOME tests: pan, zoom, and post-processing controls.
 *
 * The previous "behavioral" tests only asserted that the FOV *label text*
 * changed — a tautology (the label reads the same $state the test reads), so a
 * drag in the wrong direction, an un-centered zoom, or a control that silently
 * did nothing all passed. These read the actual center RA/Dec and sample real
 * canvas pixels, asserting direction, magnitude, center-preservation, and that
 * a control change actually repaints the image.
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForTiles(page: Page, quietMs = 1000, hardCapMs = 12000): Promise<void> {
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

async function readView(page: Page): Promise<{ ra: number; dec: number; fov: number }> {
  const t = (await page.locator('[aria-label="Field of view indicator"]').textContent()) ?? '';
  const num = (re: RegExp): number => {
    const m = t.match(re);
    return m ? parseFloat(m[1]!) : NaN;
  };
  return {
    ra: num(/RA\s+([\d.]+)°/),
    dec: num(/Dec\s+(-?[\d.]+)°/),
    fov: num(/FOV\s+([\d.]+)°/),
  };
}

/** Downsample the canvas to an 8x8 grid of mean-RGB cells (a cheap fingerprint). */
async function fingerprint(page: Page): Promise<number[]> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const { width: w, height: h } = el;
    const d = ctx.getImageData(0, 0, w, h).data;
    const N = 8;
    const out: number[] = [];
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = (gy * h) / N; y < ((gy + 1) * h) / N; y += 6) {
          for (let x = (gx * w) / N; x < ((gx + 1) * w) / N; x += 6) {
            const i = (Math.floor(y) * w + Math.floor(x)) * 4;
            r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; n++;
          }
        }
        out.push(r / n, g / n, b / n);
      }
    }
    return out;
  });
}
const changedCells = (a: number[], b: number[], eps = 6): number => {
  let c = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > eps) c++;
  return c;
};

test.describe('Interaction outcomes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForTiles(page);
  });

  test('drag right decreases center RA by the expected magnitude', async ({ page }) => {
    const before = await readView(page);
    const canvas = page.locator('.hips-canvas').first();
    const box = (await canvas.boundingBox())!;
    const dx = 120;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await waitForTiles(page);

    const after = await readView(page);
    // Direction: grab-and-drag right → sky slides right → center RA decreases.
    expect(after.ra).toBeLessThan(before.ra);
    // Magnitude: ΔRA ≈ (dx * fov / width) / cos(dec).
    const expected = (dx * before.fov) / box.width / Math.cos((before.dec * Math.PI) / 180);
    expect(Math.abs(after.ra - before.ra)).toBeGreaterThan(expected * 0.5);
    expect(Math.abs(after.ra - before.ra)).toBeLessThan(expected * 1.8);
  });

  test('drag down increases center Dec', async ({ page }) => {
    const before = await readView(page);
    const canvas = page.locator('.hips-canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 8 });
    await page.mouse.up();
    await waitForTiles(page);
    const after = await readView(page);
    expect(after.dec).toBeGreaterThan(before.dec);
  });

  test('no black screen during an active drag', async ({ page }) => {
    const canvas = page.locator('.hips-canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 4 });
    // Sample WHILE the pointer is still down (mid-drag).
    const midNonBlack = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext('2d')!;
      const d = ctx.getImageData(0, 0, el.width, el.height).data;
      let nb = 0, t = 0;
      for (let i = 0; i < d.length; i += 4 * 11) {
        if (d[i]! + d[i + 1]! + d[i + 2]! > 6) nb++;
        t++;
      }
      return nb / t;
    });
    await page.mouse.up();
    expect(midNonBlack).toBeGreaterThan(0.4); // old tiles must stay painted while dragging
  });

  test('zoom in keeps the center sky point fixed and shrinks FOV', async ({ page }) => {
    const before = await readView(page);
    await page.locator('button[aria-label="Zoom in"]').click();
    await waitForTiles(page);
    const after = await readView(page);
    expect(after.fov).toBeLessThan(before.fov);
    expect(after.ra).toBeCloseTo(before.ra, 1); // center preserved (zoom-centering)
    expect(after.dec).toBeCloseTo(before.dec, 1);
  });

  test('changing scaling actually repaints the canvas', async ({ page }) => {
    await page.locator('button[aria-label="Toggle controls panel"]').click();
    await page.waitForTimeout(300);
    const before = await fingerprint(page);
    await page.locator('#scaling-select').selectOption('log');
    await page.waitForTimeout(600);
    const after = await fingerprint(page);
    expect(changedCells(before, after)).toBeGreaterThan(8); // >1/8 of cells changed
    expect(await page.locator('[role="alert"]').isVisible().catch(() => false)).toBe(false);
  });

  test('live pixel readout appears under the cursor and tracks it (not hardcoded)', async ({
    page,
  }) => {
    const canvas = page.locator('.hips-canvas').first();
    const box = (await canvas.boundingBox())!;
    const readout = page.locator('[aria-label="Pixel readout"]');

    // Not shown until the cursor is over the canvas.
    expect(await readout.isVisible().catch(() => false)).toBe(false);

    // Hover one point → readout appears with real (non-zero) coordinates.
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.45);
    await page.waitForTimeout(200);
    await expect(readout).toBeVisible();
    const textA = (await readout.textContent()) ?? '';
    expect(textA).toContain('RA');
    // The old bug hardcoded RA/Dec to 0 → 00h00m; a live readout must not be all-zero.
    expect(textA).not.toContain('00h00m00.00s');

    // Move to a different point → the readout must CHANGE (proves it's live).
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await page.waitForTimeout(200);
    const textB = (await readout.textContent()) ?? '';
    expect(textB).not.toEqual(textA);

    // Leaving the canvas hides it.
    await page.mouse.move(box.x + box.width / 2, box.y - 40);
    await page.waitForTimeout(200);
    expect(await readout.isVisible().catch(() => false)).toBe(false);
  });

  test('adjusting the stretch (black point) repaints the canvas', async ({ page }) => {
    await page.locator('button[aria-label="Toggle controls panel"]').click();
    await page.waitForTimeout(300);

    const before = await fingerprint(page);
    // Range inputs can't be filled; set the value and dispatch input directly.
    await page.locator('#stretch-black').evaluate((el: HTMLInputElement) => {
      el.value = '0.45';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(600);
    const after = await fingerprint(page);
    expect(changedCells(before, after)).toBeGreaterThan(4);
    expect(await page.locator('[role="alert"]').isVisible().catch(() => false)).toBe(false);
  });

  test('active-layers indicator shows the base layer and switches it', async ({ page }) => {
    const layers = page.locator('[aria-label="Active layers"]');
    await expect(layers).toBeVisible();
    const baseSelect = page.locator('select[aria-label="Base layer"]');
    await expect(baseSelect).toBeVisible();
    // Default is auto (DSS when unauthenticated).
    await expect(layers).toContainText('DSS2 Color');
    // Switching to the explicit Rubin base updates the indicator + requests
    // Rubin tiles (which may 404 without data rights — that's fine here).
    await baseSelect.selectOption('rubin');
    await page.waitForTimeout(400);
    await expect(baseSelect).toHaveValue('rubin');
  });

  test('changing colormap actually repaints the canvas', async ({ page }) => {
    await page.locator('button[aria-label="Toggle controls panel"]').click();
    await page.waitForTimeout(300);
    const before = await fingerprint(page);
    await page.locator('#colormap-select').selectOption('viridis');
    await page.waitForTimeout(600);
    const after = await fingerprint(page);
    expect(changedCells(before, after)).toBeGreaterThan(8);
  });
});
