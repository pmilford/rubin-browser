import { test, expect } from '@playwright/test';

test.describe('Tile Viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Rubin Browser/);
  });

  test('toolbar is visible with controls', async ({ page }) => {
    const toolbar = page.locator('[role="toolbar"]');
    await expect(toolbar).toBeVisible();

    await expect(page.locator('#scaling-select')).toBeVisible();
    await expect(page.locator('#colormap-select')).toBeVisible();
    await expect(page.locator('#interp-select')).toBeVisible();
  });

  test('scaling dropdown has all options', async ({ page }) => {
    const select = page.locator('#scaling-select');
    const options = select.locator('option');
    await expect(options).toHaveCount(7);
    await expect(options.nth(0)).toHaveText('linear');
    await expect(options.nth(1)).toHaveText('log');
    await expect(options.nth(2)).toHaveText('sqrt');
    await expect(options.nth(3)).toHaveText('asinh');
    await expect(options.nth(4)).toHaveText('histogram');
    await expect(options.nth(5)).toHaveText('zscale');
    await expect(options.nth(6)).toHaveText('percentile');
  });

  test('color map dropdown has all options', async ({ page }) => {
    const select = page.locator('#colormap-select');
    const options = select.locator('option');
    await expect(options).toHaveCount(6);
    await expect(options.nth(0)).toHaveText('grayscale');
    await expect(options.nth(1)).toHaveText('viridis');
  });

  test('interpolation dropdown has all options', async ({ page }) => {
    const select = page.locator('#interp-select');
    const options = select.locator('option');
    await expect(options).toHaveCount(4);
    await expect(options.nth(0)).toHaveText('nearest');
    await expect(options.nth(1)).toHaveText('bilinear');
    await expect(options.nth(2)).toHaveText('bicubic');
    await expect(options.nth(3)).toHaveText('lanczos');
  });

  test('status bar shows coordinate info', async ({ page }) => {
    const statusBar = page.locator('[role="status"]');
    await expect(statusBar).toBeVisible();
    await expect(statusBar).toContainText('RA:');
    await expect(statusBar).toContainText('Dec:');
    await expect(statusBar).toContainText('Zoom:');
  });

  test('color bar canvas is rendered', async ({ page }) => {
    const canvas = page.locator('canvas[aria-label="Color map legend"]');
    await expect(canvas).toBeVisible();
  });

  test('help button opens modal', async ({ page }) => {
    const helpButton = page.locator('button[aria-label="Help"]');
    await expect(helpButton).toBeVisible();
    await helpButton.click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Keyboard Shortcuts');
    await expect(modal).toContainText('Scaling Methods');
  });

  test('help modal closes with close button', async ({ page }) => {
    await page.locator('button[aria-label="Help"]').click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    await page.locator('button[aria-label="Close help"]').click();
    await expect(modal).not.toBeVisible();
  });

  test('H key toggles help modal', async ({ page }) => {
    await page.keyboard.press('h');
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    await page.keyboard.press('h');
    await expect(modal).not.toBeVisible();
  });

  test('changing scaling updates status message', async ({ page }) => {
    await page.locator('#scaling-select').selectOption('log');
    const statusBar = page.locator('[role="status"]');
    await expect(statusBar).toContainText('Scaling: log');
  });

  test('changing color map updates status message', async ({ page }) => {
    await page.locator('#colormap-select').selectOption('viridis');
    const statusBar = page.locator('[role="status"]');
    await expect(statusBar).toContainText('Color map: viridis');
  });

  test('image viewer container exists', async ({ page }) => {
    const viewer = page.locator('.image-viewer');
    await expect(viewer).toBeVisible();
  });

  test('viewer fills available space', async ({ page }) => {
    const viewerArea = page.locator('.viewer-area');
    const box = await viewerArea.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThan(200);
  });
});
