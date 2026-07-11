/**
 * Performance HUD + fetch-efficiency OUTCOME tests.
 *
 * (1) The HUD, toggled on (default OFF), shows LIVE metrics from the real
 *     fetch/render path: tiles loaded > 0, hit-rate in [0,100], in-flight returns
 *     to 0 at idle (no leaked/stuck fetches).
 * (2) Panning away and back RAISES the cache hit-rate — proof the cache + in-flight
 *     dedup actually serve revisited tiles without new work.
 * (3) Regression for the queue-stranding bug: on the authenticated Rubin fetch
 *     path (where a >6-concurrent view QUEUES tiles through the throttle), re-running
 *     loadTiles while a STILL-VISIBLE tile is queued must not strand it — in-flight
 *     must return to 0 and the field must paint (no permanent gap), no errors.
 *
 * The main test uses the OFFLINE synthetic base: fully deterministic, no network,
 * and it exercises the same loadTiles metrics/dedup/scheduler path as network tiles.
 */

import { test, expect, type Page } from '@playwright/test';
import zlib from 'node:zlib';

// --- tiny PNG encoder (no deps), for the authenticated-path tiles --------
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
function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = 1 + w * 3;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * stride + 1 + x * 3;
    raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2];
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const GREEN = solidPng(8, 8, [0, 180, 0]);

/** Read a numeric HUD field by its stable aria-label ("42", "37%", "0", "12 ms"). */
async function hud(page: Page, label: string): Promise<number> {
  const t = (await page.locator(`[aria-label="${label}"]`).textContent()) ?? '';
  const m = t.match(/-?[\d.]+/);
  return m ? parseFloat(m[0]) : NaN;
}

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

test.describe('Performance HUD', () => {
  test('shows live metrics; cache hit-rate RISES on revisit; in-flight returns to 0', async ({ page }) => {
    // OFFLINE synthetic base: deterministic, no network, same loadTiles path.
    await page.goto('/#ra=62&dec=-37&z=4&base=offline');

    // HUD is OFF by default — assert that, then toggle it on.
    await expect(page.locator('[aria-label="Performance HUD"]')).toHaveCount(0);
    await page.locator('button[aria-label="Toggle performance HUD"]').click();
    await expect(page.locator('[aria-label="Performance HUD"]')).toBeVisible();

    // (1) Live metrics are sane, not placeholders.
    await expect.poll(() => hud(page, 'Tiles loaded'), { timeout: 8000 }).toBeGreaterThan(0);
    // In-flight returns to 0 once idle (no stuck/leaked fetches).
    await expect.poll(() => hud(page, 'In-flight fetches'), { timeout: 10000 }).toBe(0);
    const hitStart = await hud(page, 'Cache hit rate');
    expect(hitStart).toBeGreaterThanOrEqual(0);
    expect(hitStart).toBeLessThanOrEqual(100);
    expect(await hud(page, 'Error count')).toBe(0);

    // (2) Pan away to an unvisited region (new tiles → misses), then back to the
    // original region (cached → hits). The cumulative hit-rate must RISE. Use a
    // fixed settle after each navigation so the cumulative ratio has stabilised
    // (an in-flight→0 poll can return on a transient dip before the load settles).
    const search = page.locator('input[aria-label="Search coordinates"]');
    const go = page.locator('button[aria-label="Go"]');
    await search.fill('200, 10');
    await go.click();
    await page.waitForTimeout(2500);
    const hitAway = await hud(page, 'Cache hit rate');

    await search.fill('62, -37'); // revisit — these tiles are already cached
    await go.click();
    await page.waitForTimeout(2500);
    const hitBack = await hud(page, 'Cache hit rate');
    // And the in-flight gauge has returned to 0 (no stuck/leaked fetches).
    await expect.poll(() => hud(page, 'In-flight fetches'), { timeout: 10000 }).toBe(0);

    // Revisiting a previously-loaded region serves cache hits → hit-rate strictly up.
    expect(hitBack).toBeGreaterThan(hitAway);
    expect(hitBack).toBeGreaterThan(0);
  });

  test('authenticated queue path: a still-visible queued tile is never stranded', async ({ page }) => {
    // Seed an RSP token so the Rubin base uses the authenticated fetch() path
    // (which THROTTLES through a 6-slot queue — the only path that can queue).
    await page.addInitScript(() => {
      sessionStorage.setItem('rubin_rsp_token', 'test-token-b4');
    });

    // Rubin requests are rewritten to the same-origin /rsp dev-proxy path. Delay
    // each tile so a high-order view saturates the 6 concurrent slots and QUEUES
    // the rest. 404 the all-sky orders + Allsky so the backdrop doesn't compete.
    await page.route('**/rsp/**', async (route) => {
      const url = route.request().url();
      const m = /Norder(\d+)\/.*Npix\d+/.exec(url);
      if (/Allsky/.test(url) || (m && Number(m[1]) <= 1)) {
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no' });
      }
      if (m && Number(m[1]) >= 2) {
        await new Promise((r) => setTimeout(r, 350)); // saturate the queue
        return route.fulfill({ status: 200, contentType: 'image/png', body: GREEN });
      }
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no' });
    });

    await page.goto('/#ra=53.13&dec=-28.1&z=6&base=rubin');
    await page.locator('button[aria-label="Toggle performance HUD"]').click();

    // Let the first loadTiles fill 6 slots and queue the rest.
    await page.waitForTimeout(500);

    // Re-run loadTiles for the SAME view while tiles are still queued. With the old
    // fetchQueue=[] + dedup interaction this stranded the queued-but-still-visible
    // tiles forever (in-flight stuck > 0, permanent gap). The fix drains superseded
    // queue slots as no-ops and leaves still-visible queued tiles to run.
    await page.locator('input[aria-label="Search coordinates"]').fill('53.13, -28.1');
    await page.locator('button[aria-label="Go"]').click();

    // No leaked/stuck in-flight fetches, and the field actually painted (green,
    // not a permanent black gap).
    await expect.poll(() => hud(page, 'In-flight fetches'), { timeout: 25000 }).toBe(0);
    expect(await centreBrightness(page)).toBeGreaterThan(15);
    // A cancelled/superseded queued tile is NOT a failure — no errors accrued.
    expect(await hud(page, 'Error count')).toBe(0);
  });
});
