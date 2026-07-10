/**
 * PNG screenshot-export OUTCOME test (feature 106). Clicking "Save PNG screenshot"
 * must produce a real, non-empty PNG download — not merely fire a handler. We
 * assert a download event occurs, the filename is .png, and the bytes carry the
 * PNG magic signature and are non-trivial in size (a blank/failed encode or a
 * 0-byte file would fail). This is the only layer that can observe the composited
 * canvas → blob → download, which jsdom cannot.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function waitForTiles(page: Page, quietMs = 900, hardCapMs = 12000): Promise<void> {
  let last = Date.now();
  const onResp = (r: { url(): string }): void => {
    if (/Norder\d+.*Npix\d+/.test(r.url())) last = Date.now();
  };
  page.on('response', onResp);
  const start = Date.now();
  while (Date.now() - last <= quietMs && Date.now() - start <= hardCapMs) {
    await page.waitForTimeout(150);
  }
  page.off('response', onResp);
  await page.waitForTimeout(250);
}

test('Save PNG downloads a real, non-empty PNG of the current view', async ({ page }) => {
  await page.goto('/');
  await waitForTiles(page);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('button[aria-label="Save PNG screenshot"]').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.png$/);

  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = readFileSync(path!);
  // PNG magic number: 89 50 4E 47 0D 0A 1A 0A.
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // A view-sized PNG with real tile content is many KB, never a trivial blank.
  expect(bytes.length).toBeGreaterThan(2000);
});
