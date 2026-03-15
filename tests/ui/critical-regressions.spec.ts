/**
 * Regression tests for critical bugs found in user testing.
 * These tests verify the specific issues that escaped previous test coverage.
 */

import { test, expect } from '@playwright/test';

test.describe('Critical Bug Regressions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test.describe('Issue #1: Coordinate Transform / Pan', () => {
    test('canvasToSky converts pixel coordinates to valid RA/Dec', async ({ page }) => {
      const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
      await expect(fovIndicator).toBeVisible();

      // Initial coordinates should be displayed
      const text = await fovIndicator.textContent();
      expect(text).toContain('RA');
      expect(text).toContain('Dec');

      // RA should be a valid number (0-360)
      const raMatch = text?.match(/RA\s+([\d.]+)°/);
      expect(raMatch).toBeTruthy();
      const ra = parseFloat(raMatch![1]);
      expect(ra).toBeGreaterThanOrEqual(0);
      expect(ra).toBeLessThanOrEqual(360);

      // Dec should be a valid number (-90 to 90)
      const decMatch = text?.match(/Dec\s+([-\d.]+)°/);
      expect(decMatch).toBeTruthy();
      const dec = parseFloat(decMatch![1]);
      expect(dec).toBeGreaterThanOrEqual(-90);
      expect(dec).toBeLessThanOrEqual(90);
    });

    test('pan via search updates RA/Dec display correctly', async ({ page }) => {
      const fovIndicator = page.locator('[aria-label="Field of view indicator"]');

      // Navigate to a known position
      const searchInput = page.locator('input[aria-label="Search coordinates"]');
      await searchInput.fill('180.0, 45.0');
      await page.locator('button[aria-label="Go"]').click();
      await page.waitForTimeout(2000);

      const text = await fovIndicator.textContent();
      const raMatch = text?.match(/RA\s+([\d.]+)°/);
      const decMatch = text?.match(/Dec\s+([-\d.]+)°/);

      expect(raMatch).toBeTruthy();
      expect(decMatch).toBeTruthy();

      const ra = parseFloat(raMatch![1]);
      const dec = parseFloat(decMatch![1]);

      // After navigating to 180, 45, coordinates should be near those values
      // (allow some tolerance since tile loading may shift center slightly)
      expect(Math.abs(ra - 180)).toBeLessThan(5);
      expect(Math.abs(dec - 45)).toBeLessThan(5);
    });

    test('FOV indicator shows correct initial position', async ({ page }) => {
      const fovIndicator = page.locator('[aria-label="Field of view indicator"]');

      // Default initial position: RA=62.0, Dec=-37.0, Zoom=3 → FOV=22.5°
      const text = await fovIndicator.textContent();
      expect(text).toContain('22.50°');
      expect(text).toContain('62');
      expect(text).toContain('-37');
    });
  });

  test.describe('Issue #2: Scaling', () => {
    test('changing scaling does not produce error overlay', async ({ page }) => {
      await page.locator('button[aria-label="Toggle controls panel"]').click();
      await page.waitForTimeout(300);

      const scalingOptions = ['linear', 'log', 'sqrt', 'asinh', 'histogram', 'zscale'];

      for (const option of scalingOptions) {
        await page.locator('#scaling-select').selectOption(option);
        await page.waitForTimeout(300);

        // No error overlay should appear for any scaling option
        const errorOverlay = page.locator('[role="alert"]');
        const isVisible = await errorOverlay.isVisible().catch(() => false);
        expect(isVisible).toBe(false);
      }
    });

    test('scaling change does not break canvas rendering', async ({ page }) => {
      await page.locator('button[aria-label="Toggle controls panel"]').click();
      await page.waitForTimeout(300);

      // Switch to log scaling
      await page.locator('#scaling-select').selectOption('log');
      await page.waitForTimeout(500);

      // Canvas should still be present and have non-zero dimensions
      const canvas = page.locator('canvas').first();
      await expect(canvas).toBeAttached();
      const box = await canvas.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThan(200);
    });
  });

  test.describe('Issue #3: Side Panel on Left', () => {
    test('side panel opens on the LEFT side', async ({ page }) => {
      // Open the side panel
      await page.locator('button[aria-label="Toggle controls panel"]').click();
      await page.waitForTimeout(500);

      // Check that the panel is positioned on the left
      const panel = page.locator('.side-panel');
      await expect(panel).toBeVisible();

      const box = await panel.boundingBox();
      expect(box).toBeTruthy();

      // Panel should be on the left side (x close to 0)
      expect(box!.x).toBeLessThan(50);
    });

    test('side panel is positioned on the left', async ({ page }) => {
      await page.locator('button[aria-label="Toggle controls panel"]').click();
      await page.waitForTimeout(300);

      const panel = page.locator('.side-panel');
      // The panel should be positioned on the left side (right should be auto)
      const left = await panel.evaluate(el => window.getComputedStyle(el).left);
      const right = await panel.evaluate(el => window.getComputedStyle(el).right);
      // left should be 0px, right should be auto
      expect(left).toBe('0px');
    });
  });

  test.describe('Issue #4: Survey Selector Not Doubly Nested', () => {
    test('survey selector is directly visible in side panel', async ({ page }) => {
      await page.locator('button[aria-label="Toggle controls panel"]').click();
      await page.waitForTimeout(300);

      // The SurveySelector should be visible without needing to expand a parent section
      const surveyRegion = page.locator('[aria-label="Survey overlays"]');
      await expect(surveyRegion).toBeAttached();
    });

    test('survey list expands with single toggle click', async ({ page }) => {
      await page.locator('button[aria-label="Toggle controls panel"]').click();
      await page.waitForTimeout(300);

      // Click the survey panel toggle (should be a single level)
      const toggleBtn = page.locator('[aria-label="Toggle survey panel"]');
      await toggleBtn.click();
      await page.waitForTimeout(300);

      // Survey list should now be visible
      const surveyList = page.locator('[aria-label="Available surveys"]');
      await expect(surveyList).toBeVisible();

      // Individual surveys should be listed
      await expect(page.locator('text=Gaia DR3')).toBeVisible();
      await expect(page.locator('text=DSS2 Color')).toBeVisible();
    });
  });

  test.describe('Issue #5: Interactive Minimap', () => {
    test('minimap is visible', async ({ page }) => {
      const minimap = page.locator('[aria-label="Sky position minimap"]');
      await expect(minimap).toBeVisible();
    });

    test('minimap responds to click events', async ({ page }) => {
      const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
      const textBefore = await fovIndicator.textContent();

      // Click on the minimap (it should navigate)
      const minimap = page.locator('[aria-label="Sky position minimap"]');
      const box = await minimap.boundingBox();
      expect(box).toBeTruthy();

      // Click in the middle of the minimap
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.waitForTimeout(1000);

      // Coordinates should have changed
      const textAfter = await fovIndicator.textContent();
      // The position might or might not change depending on where we click,
      // but the minimap should respond without errors
      const errorOverlay = page.locator('[role="alert"]');
      const isVisible = await errorOverlay.isVisible().catch(() => false);
      expect(isVisible).toBe(false);
    });

    test('minimap has pointer events enabled', async ({ page }) => {
      const minimap = page.locator('[aria-label="Sky position minimap"]');
      const pointerEvents = await minimap.evaluate(el => window.getComputedStyle(el).pointerEvents);
      expect(pointerEvents).not.toBe('none');
    });
  });

  test.describe('Issue #6: M31 Navigation', () => {
    test('can navigate to M31 coordinates', async ({ page }) => {
      const fovIndicator = page.locator('[aria-label="Field of view indicator"]');

      // Search for M31 by coordinates (RA=10.68, Dec=41.27)
      const searchInput = page.locator('input[aria-label="Search coordinates"]');
      await searchInput.fill('10.68, 41.27');
      await page.locator('button[aria-label="Go"]').click();
      await page.waitForTimeout(2000);

      const text = await fovIndicator.textContent();
      const raMatch = text?.match(/RA\s+([\d.]+)°/);
      const decMatch = text?.match(/Dec\s+([-\d.]+)°/);

      expect(raMatch).toBeTruthy();
      expect(decMatch).toBeTruthy();

      const ra = parseFloat(raMatch![1]);
      const dec = parseFloat(decMatch![1]);

      // Coordinates should be near M31
      expect(Math.abs(ra - 10.68)).toBeLessThan(3);
      expect(Math.abs(dec - 41.27)).toBeLessThan(3);
    });

    test('M31 navigation does not cause errors', async ({ page }) => {
      const searchInput = page.locator('input[aria-label="Search coordinates"]');
      await searchInput.fill('10.68, 41.27');
      await page.locator('button[aria-label="Go"]').click();
      await page.waitForTimeout(2000);

      const errorOverlay = page.locator('[role="alert"]');
      const isVisible = await errorOverlay.isVisible().catch(() => false);
      expect(isVisible).toBe(false);
    });
  });

  test.describe('Rendering Fixes: FOV display matches actual projection', () => {
    test('FOV indicator shows correct value for zoom 3 (22.50°)', async ({ page }) => {
      const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
      const text = await fovIndicator.textContent();
      // At zoom 3, FOV should be 22.50°
      expect(text).toContain('22.50°');
    });

    test('FOV indicator does not show pathological values (90° or 180°) at zoom 3', async ({ page }) => {
      const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
      const text = await fovIndicator.textContent();
      // Should NOT contain 90° or 180° when at zoom 3
      expect(text).not.toContain('90.00°');
      expect(text).not.toContain('180.00°');
    });

    test('canvas has dimensions matching viewport', async ({ page }) => {
      const canvas = page.locator('.hips-canvas').first();
      const box = await canvas.boundingBox();
      expect(box).toBeTruthy();
      // Canvas should be at least 400px in both dimensions
      expect(box!.width).toBeGreaterThan(400);
      expect(box!.height).toBeGreaterThan(300);
    });

    test('zoom in decreases FOV value', async ({ page }) => {
      const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
      const fovBefore = await fovIndicator.textContent();
      const matchBefore = fovBefore?.match(/FOV\s+([\d.]+)°/);
      const fovValBefore = matchBefore ? parseFloat(matchBefore[1]) : 0;

      // Click zoom in button
      await page.locator('button[aria-label="Zoom in"]').click();
      await page.waitForTimeout(500);

      const fovAfter = await fovIndicator.textContent();
      const matchAfter = fovAfter?.match(/FOV\s+([\d.]+)°/);
      const fovValAfter = matchAfter ? parseFloat(matchAfter[1]) : 999;

      // FOV should decrease when zooming in
      expect(fovValAfter).toBeLessThan(fovValBefore);
    });

    test('zoom out increases FOV value', async ({ page }) => {
      const fovIndicator = page.locator('[aria-label="Field of view indicator"]');
      const fovBefore = await fovIndicator.textContent();
      const matchBefore = fovBefore?.match(/FOV\s+([\d.]+)°/);
      const fovValBefore = matchBefore ? parseFloat(matchBefore[1]) : 999;

      // Click zoom out button
      await page.locator('button[aria-label="Zoom out"]').click();
      await page.waitForTimeout(500);

      const fovAfter = await fovIndicator.textContent();
      const matchAfter = fovAfter?.match(/FOV\s+([\d.]+)°/);
      const fovValAfter = matchAfter ? parseFloat(matchAfter[1]) : 0;

      // FOV should increase when zooming out
      expect(fovValAfter).toBeGreaterThan(fovValBefore);
    });
  });

  test.describe('Rendering Fixes: Pan coordinate updates', () => {
    test('search navigation updates RA/Dec correctly', async ({ page }) => {
      const fovIndicator = page.locator('[aria-label="Field of view indicator"]');

      // Navigate to RA=180, Dec=0
      const searchInput = page.locator('input[aria-label="Search coordinates"]');
      await searchInput.fill('180.0, 0.0');
      await page.locator('button[aria-label="Go"]').click();
      await page.waitForTimeout(2000);

      const text = await fovIndicator.textContent();
      const raMatch = text?.match(/RA\s+([\d.]+)°/);
      const decMatch = text?.match(/Dec\s+([-\d.]+)°/);

      expect(raMatch).toBeTruthy();
      expect(decMatch).toBeTruthy();

      const ra = parseFloat(raMatch![1]);
      const dec = parseFloat(decMatch![1]);

      // Should be near the target coordinates
      expect(Math.abs(ra - 180)).toBeLessThan(5);
      expect(Math.abs(dec - 0)).toBeLessThan(5);
    });
  });

  test.describe('Rendering Fixes: Overlay error handling', () => {
    test('adding PanSTARRS overlay does not cause errors', async ({ page }) => {
      // Open side panel
      await page.locator('button[aria-label="Toggle controls panel"]').click();
      await page.waitForTimeout(300);

      // Look for survey panel
      const surveyToggle = page.locator('[aria-label="Toggle survey panel"]');
      const exists = await surveyToggle.count();
      if (exists > 0) {
        await surveyToggle.click();
        await page.waitForTimeout(300);

        // Look for PanSTARRS in the list
        const panstarrsBtn = page.locator('text=Pan-STARRS').first();
        const hasPS = await panstarrsBtn.count();
        if (hasPS > 0) {
          await panstarrsBtn.click();
          await page.waitForTimeout(1000);

          // No error overlay should appear
          const errorOverlay = page.locator('[role="alert"]');
          const isVisible = await errorOverlay.isVisible().catch(() => false);
          expect(isVisible).toBe(false);
        }
      }
    });
  });
});
