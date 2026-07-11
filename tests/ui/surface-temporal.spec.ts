/**
 * Surface = TEMPORAL WATERFALL of the cross-section line (user correction: the
 * 3D surface is the line cross-section over TIME, not a spatial patch). The
 * load-bearing adversarial check here: moving the drawn line CHANGES the surface.
 * The OLD spatial-relief implementation sampled a fixed central region, so it was
 * INVARIANT to the line — this test would fail for it. We also assert the honest
 * empty-state and that the surface exists only over the offline multi-epoch cube.
 */

import { test, expect, type Page } from '@playwright/test';

/** A fingerprint of the rendered surface: all polygon point strings joined. */
async function surfaceFingerprint(page: Page): Promise<string> {
  return page.locator('svg[aria-label="Intensity surface"]').evaluate((svg: SVGElement) =>
    [...svg.querySelectorAll('polygon')].map((p) => p.getAttribute('points') ?? '').join('|'),
  );
}

async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return (await page.locator('.hips-canvas').first().boundingBox())!;
}

/** Drag a line between two canvas-relative fractional points (0..1 of width/height). */
async function dragLine(page: Page, x0f: number, y0f: number, x1f: number, y1f: number): Promise<void> {
  const b = await canvasBox(page);
  await page.mouse.move(b.x + b.width * x0f, b.y + b.height * y0f);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * x1f, b.y + b.height * y1f, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

test.describe('3D surface = cross-section over time', () => {
  test('the surface tracks the DRAWN LINE (kills the static spatial-relief impl)', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);
    await page.locator('select[aria-label="Base layer"]').selectOption('offline');
    await expect(page.locator('.synthetic-banner')).toContainText('SYNTHETIC', { timeout: 8000 });

    // Jump to the brightest transient so the field has real, position-dependent signal.
    await page.locator('button[aria-label="Find a transient"]').click();
    await page.waitForTimeout(1300);

    await page.locator('button[aria-label="Toggle 3D surface plot"]').click();
    await page.waitForTimeout(400);

    // Line A: horizontal through the centre — it crosses the centred transient, so
    // the waterfall has a real peak that rises/fades across the epoch rows. (Both
    // lines stay in the clear central band so the top toolbar never steals the drag.)
    await dragLine(page, 0.2, 0.5, 0.8, 0.5);
    const svg = page.locator('svg[aria-label="Intensity surface"]');
    await expect(svg).toBeVisible({ timeout: 8000 });
    await expect.poll(async () => svg.locator('polygon').count(), { timeout: 8000 }).toBeGreaterThan(100);
    const fpA = await surfaceFingerprint(page);
    expect(fpA.length).toBeGreaterThan(0);

    // Line B: a lower, offset strip that misses the centred transient — a different
    // slice of sky, so a different profile over time.
    await dragLine(page, 0.25, 0.68, 0.75, 0.68);
    const fpB = await surfaceFingerprint(page);

    // The surface MUST differ: it is the profile of THIS line over epochs. A static
    // central-region relief (the old behaviour) would produce the same mesh for both.
    expect(fpB).not.toBe(fpA);
  });

  test('honest empty-state off the offline layer; a real waterfall on it', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await page.waitForTimeout(600);

    const toggle = page.locator('button[aria-label="Toggle 3D surface plot"]');
    const region = page.locator('[aria-label="3D surface plot"]');
    const svg = page.locator('svg[aria-label="Intensity surface"]');

    // On the default (non-offline) base, the surface has no time axis at all → the
    // panel shows the honest prompt, never a fabricated surface.
    await toggle.click();
    await expect(region).toBeVisible({ timeout: 8000 });
    await expect(svg).toHaveCount(0);
    await expect(region).toContainText('Offline');

    // Turn it off, switch to the offline multi-epoch cube, then re-enable: enabling
    // the surface seeds a cross-section line, so a real waterfall mesh appears.
    await toggle.click();
    await page.locator('select[aria-label="Base layer"]').selectOption('offline');
    await expect(page.locator('.synthetic-banner')).toContainText('SYNTHETIC', { timeout: 8000 });
    await page.waitForTimeout(400);
    await toggle.click();
    await page.waitForTimeout(500);
    await expect(svg).toBeVisible({ timeout: 8000 });
    await expect.poll(async () => svg.locator('polygon').count(), { timeout: 8000 }).toBeGreaterThan(100);
  });
});
