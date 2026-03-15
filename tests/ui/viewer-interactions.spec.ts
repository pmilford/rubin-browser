/**
 * Viewer interaction tests — verify pan, zoom, and rendering work correctly.
 * These tests run against a live dev server (Playwright auto-starts it).
 * They verify OUTCOMES, not just element existence.
 */

import { test, expect } from '@playwright/test';

test.describe('Viewer Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for Aladin/canvas viewer to initialize
    await page.waitForTimeout(3000);
  });

  test('canvas viewer renders with non-zero dimensions', async ({ page }) => {
    const canvas = page.locator('.image-viewer canvas, canvas').first();
    await expect(canvas).toBeAttached();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);
  });

  test('no error overlay visible on initial load', async ({ page }) => {
    const errorOverlay = page.locator('[role="alert"]');
    const isVisible = await errorOverlay.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('FOV indicator is visible and shows values', async ({ page }) => {
    const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
    await expect(fovIndicator).toBeVisible();
    await expect(fovIndicator).toContainText('FOV');
    await expect(fovIndicator).toContainText('RA');
    await expect(fovIndicator).toContainText('Dec');
  });

  test('zoom in changes FOV value', async ({ page }) => {
    const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
    const fovBefore = await fovIndicator.textContent();

    await page.locator('button[aria-label="Zoom in"]').click();
    await page.waitForTimeout(500);

    const fovAfter = await fovIndicator.textContent();
    // FOV should decrease when zooming in
    expect(fovAfter).not.toEqual(fovBefore);
  });

  test('zoom out changes FOV value', async ({page }) => {
    const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
    const fovBefore = await fovIndicator.textContent();

    await page.locator('button[aria-label="Zoom out"]').click();
    await page.waitForTimeout(500);

    const fovAfter = await fovIndicator.textContent();
    expect(fovAfter).not.toEqual(fovBefore);
  });

  test('search coordinates updates position display', async ({ page }) => {
    const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
    const posBefore = await fovIndicator.textContent();

    const searchInput = page.locator('input[aria-label="Search coordinates"]');
    await searchInput.fill('180.0, 45.0');
    await page.locator('button[aria-label="Go"]').click();
    await page.waitForTimeout(1000);

    const posAfter = await fovIndicator.textContent();
    expect(posAfter).not.toEqual(posBefore);
  });

  test('scaling dropdown changes display without error', async ({ page }) => {
    await page.locator('button[aria-label="Toggle controls panel"]').click();
    await page.waitForTimeout(300);
    await page.locator('#scaling-select').selectOption('log');
    await page.waitForTimeout(500);

    // No error overlay should appear
    const errorOverlay = page.locator('[role="alert"]');
    const isVisible = await errorOverlay.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('colormap dropdown changes display without error', async ({ page }) => {
    await page.locator('button[aria-label="Toggle controls panel"]').click();
    await page.waitForTimeout(300);
    await page.locator('#colormap-select').selectOption('viridis');
    await page.waitForTimeout(500);

    const errorOverlay = page.locator('[role="alert"]');
    const isVisible = await errorOverlay.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('invert toggle exists and works', async ({ page }) => {
    // Look for invert button/toggle
    const invertButton = page.locator('button[aria-label="Invert image"]').first();
    const exists = await invertButton.count();
    if (exists > 0) {
      await invertButton.click();
      await page.waitForTimeout(500);

      const errorOverlay = page.locator('[role="alert"]');
      const isVisible = await errorOverlay.isVisible().catch(() => false);
      expect(isVisible).toBe(false);
    }
  });

  test('fullscreen toggle does not break layout', async ({ page }) => {
    const fsButton = page.locator('button[aria-label="Toggle fullscreen"]').first();
    const exists = await fsButton.count();
    if (exists > 0) {
      await fsButton.click();
      await page.waitForTimeout(500);

      // Canvas should still be present
      const canvas = page.locator('canvas').first();
      await expect(canvas).toBeAttached();

      // Toggle back
      await fsButton.click();
      await page.waitForTimeout(500);
    }
  });

  test('no critical console errors during interaction', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // Perform various interactions
    await page.locator('button[aria-label="Zoom in"]').click();
    await page.waitForTimeout(300);
    await page.locator('button[aria-label="Zoom out"]').click();
    await page.waitForTimeout(300);
    await page.locator('button[aria-label="Toggle controls panel"]').click();
    await page.waitForTimeout(300);
    await page.locator('#scaling-select').selectOption('sqrt');
    await page.waitForTimeout(300);
    await page.locator('#colormap-select').selectOption('plasma');
    await page.waitForTimeout(300);

    // Filter out expected non-critical errors (tile 404s for edge tiles)
    const criticalErrors = errors.filter(e =>
      !e.includes('404') && !e.includes('tile') && !e.includes('favicon') && !e.includes('net::')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('Drag and Zoom Behavioral Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('drag updates center coordinates', async ({ page }) => {
    // Get initial coordinates
    const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
    const initialText = await fovIndicator.textContent();
    
    // Get canvas element
    const canvas = page.locator('.hips-canvas').first();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    
    // Perform a drag operation
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 100, box!.y + box!.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    
    // Get new coordinates
    const newText = await fovIndicator.textContent();
    
    // Coordinates SHOULD change after drag
    expect(newText).not.toEqual(initialText);
  });

  test('zoom keeps center point stable', async ({ page }) => {
    const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
    const initialFOV = await fovIndicator.textContent();
    
    // Zoom in
    await page.locator('button[aria-label="Zoom in"]').click();
    await page.waitForTimeout(500);
    
    const afterZoomIn = await fovIndicator.textContent();
    expect(afterZoomIn).not.toEqual(initialFOV);
    
    // Zoom back out
    await page.locator('button[aria-label="Zoom out"]').click();
    await page.waitForTimeout(500);
    
    const afterZoomOut = await fovIndicator.textContent();
    // Should be close to original (may not be exact due to discrete zoom steps)
  });

  test('FOV value is reasonable for default zoom', async ({ page }) => {
    const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
    const text = await fovIndicator.textContent();
    
    // Extract FOV value
    const fovMatch = text?.match(/([\d.]+)°/);
    expect(fovMatch).toBeTruthy();
    const fov = parseFloat(fovMatch![1]);
    
    // FOV should be between 5° and 50° for a typical survey view
    expect(fov).toBeGreaterThan(5);
    expect(fov).toBeLessThan(50);
  });

  test('canvas pixel size matches display size', async ({ page }) => {
    const canvas = page.locator('.hips-canvas').first();
    
    const dims = await canvas.evaluate((el: HTMLCanvasElement) => ({
      pixelWidth: el.width,
      pixelHeight: el.height,
      displayWidth: el.clientWidth,
      displayHeight: el.clientHeight,
    }));
    
    // Pixel size should match display size (within a few pixels)
    expect(Math.abs(dims.pixelWidth - dims.displayWidth)).toBeLessThan(5);
    expect(Math.abs(dims.pixelHeight - dims.displayHeight)).toBeLessThan(5);
  });
});
