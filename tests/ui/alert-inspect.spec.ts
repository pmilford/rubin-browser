/**
 * Alert overlay: hover inspector + time-window filter OUTCOME tests. The overlay
 * data is the deterministic 200k synthetic set; at the default view it's dense, so
 * hovering finds an alert, and narrowing the time window drops the count.
 */

import { test, expect, type Page } from '@playwright/test';

async function enableAlerts(page: Page) {
  await page.goto('/');
  await page.waitForTimeout(600);
  await page.locator('button[aria-label="Toggle alert overlay"]').click();
  await expect(page.locator('.alert-legend')).toBeVisible({ timeout: 8000 });
}

/** The integer count shown in the time-window readout. */
async function windowCount(page: Page): Promise<number> {
  const t = (await page.locator('.alert-time-readout').textContent()) ?? '';
  const m = t.match(/·\s*([\d,]+)/);
  return m ? parseInt(m[1]!.replace(/,/g, ''), 10) : -1;
}

test.describe('Alert overlay — inspect + time filter', () => {
  test('hovering the dense overlay shows the alert inspector (type + mag + MJD)', async ({ page }: { page: Page }) => {
    await enableAlerts(page);
    const canvas = page.locator('.hips-canvas').first();
    const box = (await canvas.boundingBox())!;
    const inspector = page.locator('.alert-inspector');

    // Sweep a few points near centre; the 200k set is dense at the default view so
    // at least one lands within the hit-test tolerance.
    let shown = false;
    for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.5, 0.4], [0.6, 0.6]] as const) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(180);
      if (await inspector.isVisible().catch(() => false)) { shown = true; break; }
    }
    expect(shown).toBe(true);
    await expect(inspector).toContainText(/mag\s/);
    await expect(inspector).toContainText(/MJD\s/);
  });

  test('narrowing the time window reduces the alert count', async ({ page }: { page: Page }) => {
    await enableAlerts(page);
    await expect(page.locator('.alert-time')).toBeVisible();

    const startSlider = page.locator('input[aria-label="Alert window start (MJD)"]');
    const endSlider = page.locator('input[aria-label="Alert window end (MJD)"]');

    // Full window first (drag both to extremes to be sure), then read the count.
    const lo = await startSlider.getAttribute('min');
    const hi = await startSlider.getAttribute('max');
    await startSlider.fill(lo!);
    await endSlider.fill(hi!);
    await page.waitForTimeout(200);
    const full = await windowCount(page);

    // Narrow to the first ~10% of the time span.
    const narrowedMax = Math.round(parseFloat(lo!) + (parseFloat(hi!) - parseFloat(lo!)) * 0.1);
    await endSlider.fill(String(narrowedMax));
    await page.waitForTimeout(300);
    const narrowed = await windowCount(page);

    // The windowed count must drop well below the full set (a broken all-pass
    // filter would leave it unchanged).
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(full * 0.5);
  });
});
