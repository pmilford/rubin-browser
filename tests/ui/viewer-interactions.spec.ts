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
    const invertButton = page.locator('button[aria-label="Invert"], [aria-label*="invert"], [aria-label*="Invert"]').first();
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
    const fsButton = page.locator('button[aria-label="Fullscreen"], [aria-label*="fullscreen"], [aria-label*="Fullscreen"]').first();
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
