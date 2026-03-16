import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = join(__dirname, 'screenshots');

test.describe('Canvas actually renders data', () => {
  test.beforeAll(() => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('canvas has non-trivial pixel data (not all black)', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(5000); // Wait for tiles to load

    const canvas = page.locator('.hips-canvas').first();
    await expect(canvas).toBeAttached();

    // Sample pixel data from the canvas
    const pixelData = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext('2d');
      if (!ctx) return null;
      const w = el.width;
      const h = el.height;
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;

      // Count non-black pixels
      let nonBlack = 0;
      let totalBrightness = 0;
      const samples: number[] = [];
      
      // Sample center region (where tiles should be)
      const cx = Math.floor(w / 2);
      const cy = Math.floor(h / 2);
      const sampleSize = Math.min(200, w, h);
      const startX = cx - sampleSize / 2;
      const startY = cy - sampleSize / 2;
      
      for (let y = startY; y < startY + sampleSize; y++) {
        for (let x = startX; x < startX + sampleSize; x++) {
          const idx = (Math.floor(y) * w + Math.floor(x)) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const brightness = r + g + b;
          totalBrightness += brightness;
          if (brightness > 10) nonBlack++; // Not pure black
        }
      }

      const totalPixels = sampleSize * sampleSize;
      return {
        width: w,
        height: h,
        nonBlackPixels: nonBlack,
        totalSampled: totalPixels,
        percentNonBlack: ((nonBlack / totalPixels) * 100).toFixed(1),
        avgBrightness: (totalBrightness / (totalPixels * 3)).toFixed(1),
        // Sample a few specific pixels
        centerPixel: { 
          r: data[(cy * w + cx) * 4], 
          g: data[(cy * w + cx) * 4 + 1], 
          b: data[(cy * w + cx) * 4 + 2] 
        },
      };
    });

    console.log('Canvas pixel analysis:', JSON.stringify(pixelData, null, 2));
    
    expect(pixelData).not.toBeNull();
    expect(pixelData!.width).toBeGreaterThan(400);
    expect(pixelData!.height).toBeGreaterThan(300);
    
    // THE ACTUAL TEST: canvas must have non-black content
    expect(pixelData!.nonBlackPixels).toBeGreaterThan(100);
    expect(parseFloat(pixelData!.percentNonBlack)).toBeGreaterThan(5);
  });

  test('screenshot shows visible content', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(5000);

    // Take full-page screenshot
    await page.screenshot({ 
      path: join(SCREENSHOT_DIR, 'initial-load.png'),
      fullPage: true 
    });

    // Also screenshot just the canvas
    const canvas = page.locator('.hips-canvas').first();
    await canvas.screenshot({ 
      path: join(SCREENSHOT_DIR, 'canvas-only.png') 
    });

    // Verify screenshot file exists and is non-trivial
    const fs = await import('fs');
    const canvasShot = fs.statSync(join(SCREENSHOT_DIR, 'canvas-only.png'));
    expect(canvasShot.size).toBeGreaterThan(1000); // At least 1KB
    console.log(`Canvas screenshot: ${canvasShot.size} bytes`);
  });

  test('tile network requests succeed', async ({ page }) => {
    const tileRequests: { url: string; status: number }[] = [];
    
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('Norder') && url.includes('Npix')) {
        tileRequests.push({ url, status: response.status() });
      }
    });

    await page.goto('/');
    await page.waitForTimeout(5000);

    console.log(`Tile requests: ${tileRequests.length}`);
    const failed = tileRequests.filter(t => t.status >= 400);
    console.log(`Failed tiles: ${failed.length}`);
    if (failed.length > 0) {
      console.log('Failed URLs:', failed.map(f => `${f.url} → ${f.status}`).join('\n'));
    }

    // At least some tiles should have been requested
    expect(tileRequests.length).toBeGreaterThan(0);
    
    // Most should succeed (allow some 404s for edge tiles)
    const successRate = (tileRequests.length - failed.length) / tileRequests.length;
    expect(successRate).toBeGreaterThan(0.5);
  });
});
