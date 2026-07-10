/**
 * Sparse-survey zoom-out OUTCOME test (the "Rubin field vanishes when I zoom out"
 * bug). Rubin DP1 is a SPARSE HiPS: it has tiles only in a few fields and no
 * low-order/all-sky tiles. Zooming out drops the target order below the survey's
 * available orders, so the target tiles 404 and the ancestor pass finds nothing —
 * the field you had zoomed into would vanish (black on explicit Rubin).
 *
 * We simulate that survey with page.route: serve tiles while zoomed IN, then 404
 * EVERYTHING and zoom out. With the "residual finer cached tiles" pass the field
 * stays embedded (the cached high-order tiles keep painting); without it the
 * centre goes black. We never serve the all-sky (order ≤ 1) tiles, so there is no
 * low-order backdrop masking the effect. Deterministic, offline, no token.
 */

import { test, expect, type Page } from '@playwright/test';
import zlib from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
/** A solid-colour RGB PNG (no external deps) so route.fulfill returns a real tile. */
function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const stride = 1 + w * 3;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 3;
      raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2];
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const GREEN = solidPng(8, 8, [0, 180, 0]);

/** Mean brightness of the centre 200×200 px of the tile canvas. */
async function centreBrightness(page: Page): Promise<number> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const s = 200;
    const x0 = Math.floor(el.width / 2 - s / 2);
    const y0 = Math.floor(el.height / 2 - s / 2);
    const d = ctx.getImageData(x0, y0, s, s).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
    return sum / (d.length / 4);
  });
}

test('a sparse survey field stays visible (not black) when zooming out', async ({ page }) => {
  let serveTiles = true;
  await page.route('**/api/hips/**', async (route) => {
    const url = route.request().url();
    const m = /Norder(\d+)\/.*Npix\d+/.exec(url);
    // Serve tiles only while zoomed in, and NEVER the all-sky orders (≤1) — a
    // sparse survey has no low-order backdrop.
    if (serveTiles && m && Number(m[1]) >= 2) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: GREEN });
    } else {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'no tile' });
    }
  });

  // Explicit Rubin (no token → img.src via the /rsp proxy; no DSS fallback → black
  // where there is no tile), zoomed in onto a "field".
  await page.goto('/#ra=53.13&dec=-28.1&z=7&base=rubin');
  await page.waitForTimeout(2500);

  const zoomedIn = await centreBrightness(page);
  expect(zoomedIn).toBeGreaterThan(15); // the field loaded green while zoomed in

  // Now the survey has no coarser tiles: 404 everything and zoom out a couple steps.
  serveTiles = false;
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('-');
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(800);

  // The residual-cached-tile pass keeps the field embedded; without the fix the
  // centre would be black (all target tiles 404, no ancestor, no residual).
  const zoomedOut = await centreBrightness(page);
  expect(zoomedOut).toBeGreaterThan(15);
});
