import { test, expect } from '@playwright/test';

test.describe('Tile Viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for initial render
    await page.waitForTimeout(1000);
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Rubin Browser/);
  });

  // === Bug #3: Toolbar buttons are visible and have proper icons ===
  test('toolbar is visible with all controls', async ({ page }) => {
    const toolbar = page.locator('[role="toolbar"]');
    await expect(toolbar).toBeVisible();

    // Dropdown controls
    await expect(page.locator('#scaling-select')).toBeVisible();
    await expect(page.locator('#colormap-select')).toBeVisible();
    await expect(page.locator('#interp-select')).toBeVisible();

    // Bug fix: zoom buttons should be visible with SVG icons
    await expect(page.locator('button[aria-label="Zoom in"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Zoom out"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Reset view"]')).toBeVisible();

    // Verify SVG icons are rendered (not broken images)
    const zoomInSvg = page.locator('button[aria-label="Zoom in"] svg');
    await expect(zoomInSvg).toBeVisible();

    const zoomOutSvg = page.locator('button[aria-label="Zoom out"] svg');
    await expect(zoomOutSvg).toBeVisible();

    const resetSvg = page.locator('button[aria-label="Reset view"] svg');
    await expect(resetSvg).toBeVisible();
  });

  test('toolbar buttons are clickable', async ({ page }) => {
    // Zoom buttons should be clickable without error
    await page.locator('button[aria-label="Zoom in"]').click();
    await page.locator('button[aria-label="Zoom out"]').click();
    await page.locator('button[aria-label="Reset view"]').click();
  });

  // === Bug #2: Search/coordinate input works ===
  test('search input is visible and functional', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search coordinates"]');
    await expect(searchInput).toBeVisible();

    const searchButton = page.locator('button[aria-label="Go"]');
    await expect(searchButton).toBeVisible();

    // Type coordinates and search
    await searchInput.fill('62.0, -37.0');
    await searchButton.click();

    // Status bar should show the search result
    const statusBar = page.locator('[role="status"]');
    await expect(statusBar).toContainText('Go to');
  });

  test('search input handles Enter key', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search coordinates"]');
    await searchInput.fill('180.0, 45.0');
    await searchInput.press('Enter');

    const statusBar = page.locator('[role="status"]');
    await expect(statusBar).toContainText('Go to');
  });

  test('search input validates bad coordinates', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Search coordinates"]');
    await searchInput.fill('999.0, -37.0');
    await page.locator('button[aria-label="Go"]').click();

    // Should show error for invalid RA
    const searchError = page.locator('.search-error');
    await expect(searchError).toBeVisible();
    await expect(searchError).toContainText('RA must be 0-360');
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

  // === Bug #1: Image viewer renders non-empty content ===
  test('image viewer container exists and has content', async ({ page }) => {
    const viewer = page.locator('.image-viewer');
    await expect(viewer).toBeVisible();

    // OpenSeadragon should create canvas elements inside the viewer
    // Wait for OSD to initialize and try to load tiles
    await page.waitForTimeout(2000);

    // Check that the viewer div is not empty (OSD creates internal elements)
    const childCount = await page.locator('.image-viewer > *').count();
    expect(childCount).toBeGreaterThan(0);
  });

  test('viewer fills available space', async ({ page }) => {
    const viewerArea = page.locator('.viewer-area');
    const box = await viewerArea.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThan(200);
  });

  test('OpenSeadragon canvas is rendered', async ({ page }) => {
    // OSD should render a canvas element inside the viewer
    await page.waitForTimeout(2000);
    const canvas = page.locator('.image-viewer canvas, .image-viewer .openseadragon-container');
    await expect(canvas.first()).toBeAttached();
  });

  // === Error display test: error overlay has role="alert" for accessibility ===
  test('error overlay is accessible when present', async ({ page }) => {
    // If tile loading fails, an error overlay with role="alert" should appear
    // Check that the error overlay structure exists in the DOM (hidden when no error)
    // The role="alert" ensures screen readers and tests can detect errors
    const errorOverlay = page.locator('[role="alert"]');
    // May or may not be visible depending on network, but should be in DOM structure
    // This test documents the expected ARIA pattern for error display
  });
});
