/**
 * Rubin visit-image BLINK outcome test (feature 136 / TODO 35), deterministic via
 * page.route — no live RSP. It drives the WHOLE pipeline the token-gated live spec
 * can't run in CI: ObsCore discovery (VOTable, MULTIPLE epochs) → per-epoch SODA
 * cutout FITS → decode → the blink panel. It asserts the CLAUDE.md outcomes: the
 * panel mounts with the right epoch count, the canvas paints non-black pixels, and
 * — the whole point of a blink — scrubbing the slider CHANGES the frame pixels and
 * the MJD read-out (a static single-frame impl fails). An RSP token is seeded so
 * isAuthenticated() is true (visit images are auth-gated).
 */

import { test, expect, type Page } from '@playwright/test';
import { votableFromRows } from './helpers/votable.js';

// --- Synthetic FITS builder (mirrors cutout.spec.ts byte layout) --------------
const BLOCK = 2880;
const CARD = 80;
const card = (t: string): string => t.padEnd(CARD, ' ');
const valueCard = (k: string, v: string): string => card(`${k.padEnd(8, ' ').slice(0, 8)}= ${v}`);

function buildHeaderBytes(cards: string[]): Uint8Array {
  let text = [...cards, card('END')].join('');
  text = text.padEnd(Math.ceil(text.length / BLOCK) * BLOCK, ' ');
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/**
 * A 16×16 float32 FITS (TAN WCS about 62/−37) with a fixed gradient PLUS a bright
 * core whose PIXEL POSITION depends on `epoch` — so each epoch decodes to a
 * visibly different frame (the blink must change with time, even after per-frame
 * auto-scaling flattens a uniform image).
 */
function buildEpochFits(epoch: number, width = 16, height = 16): Buffer {
  const cards = [
    valueCard('SIMPLE', 'T'), valueCard('BITPIX', '-32'), valueCard('NAXIS', '2'),
    valueCard('NAXIS1', String(width)), valueCard('NAXIS2', String(height)),
    valueCard('OBJECT', "'VISIT-BLINK'"), valueCard('BUNIT', "'nJy     '"),
    valueCard('CRPIX1', String((width + 1) / 2)), valueCard('CRPIX2', String((height + 1) / 2)),
    valueCard('CRVAL1', '62.0'), valueCard('CRVAL2', '-37.0'),
    valueCard('CD1_1', '-0.0001'), valueCard('CD1_2', '0.0'),
    valueCard('CD2_1', '0.0'), valueCard('CD2_2', '0.0001'),
    valueCard('CTYPE1', "'RA---TAN'"), valueCard('CTYPE2', "'DEC--TAN'"),
  ];
  const header = buildHeaderBytes(cards);
  const pixelCount = width * height;
  const dataBlocks = Math.ceil((pixelCount * 4) / BLOCK);
  const buffer = new ArrayBuffer(header.length + dataBlocks * BLOCK);
  new Uint8Array(buffer).set(header, 0);
  const view = new DataView(buffer, header.length);
  const brightIdx = (epoch * 53) % pixelCount; // distinct hot pixel per epoch
  for (let i = 0; i < pixelCount; i++) {
    view.setFloat32(i * 4, i === brightIdx ? 8000 : (i % 255) + 1); // big-endian
  }
  return Buffer.from(buffer);
}

async function seedToken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('rubin_rsp_token', 'fake-test-token'); } catch { /* ignore */ }
  });
}

/** Three visit-image epochs at distinct t_min, each a DataLink ID=epoch-N. */
const EPOCH_ROWS = [0, 1, 2].map((n) => ({
  access_format: 'application/x-votable+xml;content=datalink',
  access_url: `https://data.lsst.cloud/api/datalink/links?ID=epoch-${n}`,
  dataproduct_subtype: 'lsst.visit_image',
  t_min: 60000 + n * 5,
  lsst_band: 'r',
  s_ra: 62.0,
  s_dec: -37.0,
}));

/** Native-resolution RGBA fingerprint of the blink frame canvas. */
async function frameFingerprint(page: Page): Promise<number[]> {
  return page.locator('canvas[aria-label="Visit image frame"]').evaluate((el: HTMLCanvasElement) => {
    const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 16) out.push(d[i]!);
    return out;
  });
}

test('visit-image blink: discovers epochs, paints a frame, and scrubbing changes the frame', async ({ page }) => {
  await seedToken(page);

  // ObsCore discovery → VOTable with three visit_image epochs (client parses VOTable).
  await page.route('**/api/tap/sync', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-votable+xml', body: votableFromRows(EPOCH_ROWS) })
  );
  // Per-epoch SODA cutout → a FITS chosen by the ID query param (epoch-N).
  await page.route('**/api/cutout/**', (route) => {
    const m = route.request().url().match(/ID=epoch-(\d+)/);
    route.fulfill({ status: 200, contentType: 'application/fits', body: buildEpochFits(Number(m?.[1] ?? 0)) });
  });

  await page.goto('/');
  await page.waitForTimeout(400);
  await page.locator('button[aria-label="Toggle Rubin visit-image time series"]').click();

  // The panel mounts and reports the discovered epoch count (3 of 3).
  const panel = page.locator('[aria-label="Visit image blink"]');
  await expect(panel).toBeVisible({ timeout: 15000 });
  const readout = page.locator('[aria-label="Visit image epoch readout"]');
  await expect(readout).toContainText('/ 3', { timeout: 15000 });
  await expect(readout).toContainText('MJD 60000');

  // The frame canvas paints NON-BLACK pixels (a real decode, not a placeholder).
  const canvas = page.locator('canvas[aria-label="Visit image frame"]');
  await expect(canvas).toBeVisible();
  const nonBlack = await canvas.evaluate((el: HTMLCanvasElement) => {
    const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    let nb = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 10 && d[i + 3]! > 0) nb++;
    return nb;
  });
  expect(nonBlack).toBeGreaterThan(0);

  // THE BLINK: scrubbing to the last epoch must change the frame pixels AND the
  // MJD read-out — a static/single-frame implementation fails both.
  const first = await frameFingerprint(page);
  const slider = page.locator('input[aria-label="Visit image epoch"]');
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = String(Number(el.max));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(readout).toContainText('MJD 60010');
  const last = await frameFingerprint(page);
  expect(last).not.toEqual(first);
});
