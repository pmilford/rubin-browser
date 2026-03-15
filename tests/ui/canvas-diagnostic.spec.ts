import { test, expect } from '@playwright/test';

test('canvas pixel dimensions match display dimensions', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);
  
  const canvas = page.locator('canvas').first();
  const info = await canvas.evaluate((el: HTMLCanvasElement) => {
    const rect = el.getBoundingClientRect();
    return {
      pixelW: el.width,
      pixelH: el.height, 
      displayW: Math.round(rect.width),
      displayH: Math.round(rect.height),
      clientW: el.clientWidth,
      clientH: el.clientHeight,
    };
  });
  
  // Pixel dimensions MUST match display dimensions
  expect(info.pixelW).toBe(info.displayW);
  expect(info.pixelH).toBe(info.displayH);
  expect(info.pixelW).toBeGreaterThan(400);
  expect(info.pixelH).toBeGreaterThan(300);
});
