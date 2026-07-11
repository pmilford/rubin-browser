/**
 * Touch pinch-zoom OUTCOME test (feature 127). The viewer uses pointer events, so
 * we dispatch synthetic touch-type PointerEvents for two fingers and assert the
 * REAL outcome — spreading the fingers zooms IN (field of view shrinks), pinching
 * them together zooms OUT — read from the live FOV indicator, not from "an event
 * fired". A no-op / wrong-direction implementation fails.
 */

import { test, expect, type Page } from '@playwright/test';

async function readFov(page: Page): Promise<number> {
  const t = (await page.locator('[aria-label="Field of view indicator"]').textContent()) ?? '';
  const m = t.match(/([\d.]+)°/);
  return m ? parseFloat(m[1]!) : NaN;
}

/** Dispatch a two-finger pinch on the canvas: fingers start `from` px apart on
 *  either side of centre and end `to` px apart. Returns nothing; asserts via FOV. */
async function pinch(page: Page, fromHalf: number, toHalf: number): Promise<void> {
  await page.locator('.hips-canvas').first().evaluate(
    (canvas: HTMLElement, { fromHalf, toHalf }: { fromHalf: number; toHalf: number }) => {
      const r = canvas.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      const cx = r.left + r.width / 2;
      const mk = (id: number, x: number, type: string) =>
        canvas.dispatchEvent(
          new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: cy, bubbles: true })
        );
      // Two fingers down, `fromHalf` px either side of centre.
      mk(1, cx - fromHalf, 'pointerdown');
      mk(2, cx + fromHalf, 'pointerdown');
      // Move them to `toHalf` px either side (spread or squeeze), in steps.
      const steps = 6;
      for (let s = 1; s <= steps; s++) {
        const h = fromHalf + ((toHalf - fromHalf) * s) / steps;
        mk(1, cx - h, 'pointermove');
        mk(2, cx + h, 'pointermove');
      }
      mk(1, cx - toHalf, 'pointerup');
      mk(2, cx + toHalf, 'pointerup');
    },
    { fromHalf, toHalf }
  );
  await page.waitForTimeout(300);
}

test.describe('Touch pinch-to-zoom', () => {
  test('spreading two fingers zooms IN (FOV shrinks); pinching zooms OUT', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(800);

    const fov0 = await readFov(page);
    expect(Number.isFinite(fov0)).toBe(true);

    // Spread 60px→220px per side ⇒ ~1.9× distance ⇒ zoom in ⇒ FOV must drop.
    await pinch(page, 60, 220);
    const fovIn = await readFov(page);
    expect(fovIn).toBeLessThan(fov0 * 0.95);

    // Now pinch back together ⇒ zoom out ⇒ FOV must rise above the zoomed-in value.
    await pinch(page, 220, 60);
    const fovOut = await readFov(page);
    expect(fovOut).toBeGreaterThan(fovIn * 1.05);
  });
});
