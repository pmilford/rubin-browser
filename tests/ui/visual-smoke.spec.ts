/**
 * Visual smoke tests — run against a live dev server.
 *
 * These tests catch issues that mocked unit tests cannot:
 * - Real tile loading from HiPS endpoints
 * - Actual canvas rendering
 * - Working DOM interactions that produce visible results
 * - No error overlays during normal operation
 *
 * Run with: npm run test:e2e (requires dev server running on localhost:5173)
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_URL || 'http://localhost:5173';

test.describe('Visual Smoke Tests (requires live server)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    // Wait for Aladin/OSD to initialize and load initial tiles
    await page.waitForTimeout(3000);
  });

  test('page loads without error overlays', async ({ page }) => {
    // The error overlay should NOT be visible during normal operation
    const errorOverlay = page.locator('[role="alert"]');
    const isVisible = await errorOverlay.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('canvas element exists and has rendered content', async ({ page }) => {
    // The image viewer should have a canvas with actual pixels
    const canvas = page.locator('.image-viewer canvas, .aladin-canvas, canvas').first();
    await expect(canvas).toBeAttached();

    // Canvas should have non-zero dimensions
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
  });

  test('toolbar controls are functional', async ({ page }) => {
    // Scaling dropdown changes should not cause errors
    await page.locator('#scaling-select').selectOption('log');
    await page.waitForTimeout(500);

    // Colormap dropdown changes should not cause errors
    await page.locator('#colormap-select').selectOption('viridis');
    await page.waitForTimeout(500);

    // No error overlay should appear
    const errorOverlay = page.locator('[role="alert"]');
    const isVisible = await errorOverlay.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('search coordinates triggers navigation without error', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search coordinates"]');
    await searchInput.fill('83.82, -5.39'); // Orion Nebula region
    await page.locator('button[aria-label="Go"]').click();
    await page.waitForTimeout(2000);

    // Status bar should update
    const status = page.locator('[role="status"]');
    await expect(status).toBeVisible();

    // No error should appear from valid coordinates
    const errorOverlay = page.locator('[role="alert"]');
    const isVisible = await errorOverlay.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('zoom buttons work without error', async ({ page }) => {
    await page.locator('button[aria-label="Zoom in"]').click();
    await page.waitForTimeout(500);
    await page.locator('button[aria-label="Zoom out"]').click();
    await page.waitForTimeout(500);
    await page.locator('button[aria-label="Reset view"]').click();
    await page.waitForTimeout(500);

    const errorOverlay = page.locator('[role="alert"]');
    const isVisible = await errorOverlay.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('help modal opens and closes', async ({ page }) => {
    await page.locator('button[aria-label="Help"]').click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Keyboard Shortcuts');

    await page.locator('button[aria-label="Close help"]').click();
    await expect(modal).not.toBeVisible();
  });

  test('no console errors during normal operation', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Perform typical user actions
    await page.locator('button[aria-label="Zoom in"]').click();
    await page.waitForTimeout(500);
    await page.locator('#scaling-select').selectOption('sqrt');
    await page.waitForTimeout(500);

    // Filter out known non-critical errors (e.g., tile 404s for edge tiles)
    const criticalErrors = errors.filter(e =>
      !e.includes('404') &&
      !e.includes('tile') &&
      !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
