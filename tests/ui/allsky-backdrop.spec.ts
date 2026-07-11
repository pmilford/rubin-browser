/**
 * HiPS Allsky backdrop OUTCOME tests.
 *
 * PRIMARY path: the viewer fetches the survey's SINGLE `Norder3/Allsky.<ext>`
 * preview (one request, not 48 individual order-1 tiles) and slices it into its
 * 768 order-3 tiles as a coarse full-sky backdrop. This is asserted FALSIFIABLY:
 * one Allsky request, zero order-1 tile requests, AND — with the sharp tiles 404ed
 * so only the backdrop shows — the order-3 NPIX at the view centre paints its OWN
 * colour at the centre of the canvas (a flipped / mis-packed slice would paint a
 * different cell there, so nonBlack alone can't pass a broken slice).
 *
 * FALLBACK path: if the Allsky file 404s, the viewer falls back to enumerating the
 * 48 order-1 tiles, still painting a non-black backdrop and never a hard error.
 *
 * Deterministic via page.route; the expected centre NPIX is computed with the same
 * @hscmap/healpix primitive the app uses (NESTED order-3), and the Allsky packing
 * (27 tiles/row, ipix→divmod(ipix,27)) mirrors the IVOA HiPS convention.
 */

import { test, expect, type Page } from '@playwright/test';
import zlib from 'node:zlib';
import { ang2pix_nest, order2nside } from '@hscmap/healpix';

const DEG2RAD = Math.PI / 180;
const ALLSKY_ORDER = 3;
const TILES_PER_ROW = 27; // int(sqrt(768))
const CELL = 8; // px per tile in the test mosaic → 216×216 Allsky

/** The NESTED order-3 pixel containing (ra,dec) — the tile at the view centre. */
function centrePix(ra: number, dec: number): number {
  const nside = order2nside(ALLSKY_ORDER);
  const theta = (90 - dec) * DEG2RAD;
  const phi = (((ra % 360) + 360) % 360) * DEG2RAD;
  return ang2pix_nest(nside, theta, phi);
}

// --- tiny PNG encoder (no deps) -------------------------------------------
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
/** RGB PNG from a per-pixel colour callback. */
function rgbPng(w: number, h: number, at: (x: number, y: number) => [number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = 1 + w * 3;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * stride + 1 + x * 3;
    const [r, g, b] = at(x, y);
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
function solid(w: number, h: number, rgb: [number, number, number]): Buffer {
  return rgbPng(w, h, () => rgb);
}

const CORS = { 'access-control-allow-origin': '*' };
const BLUE: [number, number, number] = [30, 40, 120];
const RED: [number, number, number] = [220, 30, 30];

/** Mean RGB of the centre 40×40 px of the tile canvas. */
async function centreRgb(page: Page): Promise<[number, number, number]> {
  return page.locator('.hips-canvas').first().evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const s = 40;
    const x0 = Math.floor(el.width / 2 - s / 2);
    const y0 = Math.floor(el.height / 2 - s / 2);
    const d = ctx.getImageData(x0, y0, s, s).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; }
    const n = d.length / 4;
    return [r / n, g / n, b / n] as [number, number, number];
  });
}

test.describe('HiPS Allsky backdrop', () => {
  test('fetches ONE Allsky preview and slices the correct NPIX to the view centre', async ({ page }) => {
    const allskyReqs: string[] = [];
    const order1Reqs = new Set<string>();
    page.on('request', (req) => {
      const u = req.url();
      if (/Norder3\/Allsky/.test(u)) allskyReqs.push(u);
      if (/Norder1\/.*Npix\d+/.test(u)) order1Reqs.add(u);
    });

    // The order-3 tile at the default view centre (62, -37) must paint RED; all
    // other cells are BLUE. A flip / mis-slice paints a different cell at centre.
    const pix = centrePix(62, -37);
    const cCol = pix % TILES_PER_ROW;
    const cRow = Math.floor(pix / TILES_PER_ROW);
    const mosaic = rgbPng(TILES_PER_ROW * CELL, TILES_PER_ROW * CELL, (x, y) => {
      const col = Math.floor(x / CELL);
      const row = Math.floor(y / CELL);
      return col === cCol && row === cRow ? RED : BLUE;
    });

    await page.route('**/alasky.cds.unistra.fr/**', (route) => {
      const url = route.request().url();
      if (url.endsWith('/properties')) {
        return route.fulfill({ status: 200, contentType: 'text/plain', headers: CORS, body: 'hips_order=9\nhips_tile_format=jpeg\n' });
      }
      if (/Norder3\/Allsky/.test(url)) {
        return route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: mosaic });
      }
      // 404 every SHARP tile so only the Pass-0 backdrop shows at the centre.
      return route.fulfill({ status: 404, contentType: 'text/plain', headers: CORS, body: 'no tile' });
    });

    await page.goto('/');
    await page.locator('select[aria-label="Base layer"]').selectOption('dss');
    // Poll until the sliced backdrop has painted the centre tile.
    await expect.poll(async () => (await centreRgb(page))[0], { timeout: 12000 }).toBeGreaterThan(120);

    const [r, g, b] = await centreRgb(page);
    // The centre NPIX's OWN colour (red), proving the slice mapped that cell to the
    // right sky location — not a flipped/mis-packed cell (which would read blue).
    expect(r).toBeGreaterThan(120);
    expect(r).toBeGreaterThan(g + 40);
    expect(r).toBeGreaterThan(b + 40);

    // Exactly the single-Allsky path: one Allsky request, and NOT the 48-tile
    // order-1 enumeration (the fallback we replaced).
    expect(allskyReqs.length).toBe(1);
    expect(order1Reqs.size).toBe(0);
  });

  test('falls back to the order-1 enumeration (still non-black) when Allsky 404s', async ({ page }) => {
    const allskyReqs: string[] = [];
    const order1Reqs = new Set<string>();
    page.on('request', (req) => {
      const u = req.url();
      if (/Norder3\/Allsky/.test(u)) allskyReqs.push(u);
      if (/Norder1\/.*Npix\d+/.test(u)) order1Reqs.add(u);
    });

    await page.route('**/alasky.cds.unistra.fr/**', (route) => {
      const url = route.request().url();
      if (url.endsWith('/properties')) {
        return route.fulfill({ status: 200, contentType: 'text/plain', headers: CORS, body: 'hips_order=9\nhips_tile_format=jpeg\n' });
      }
      if (/Norder3\/Allsky/.test(url)) {
        // ONLY the Allsky 404s — the fetch-efficiency win is unavailable here.
        return route.fulfill({ status: 404, contentType: 'text/plain', headers: CORS, body: 'no allsky' });
      }
      if (/Norder1\/.*Npix\d+/.test(url)) {
        // The order-1 fallback backdrop tiles — served so the backdrop enumerates.
        return route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: solid(8, 8, [120, 130, 160]) });
      }
      // Sharp tiles succeed (grey), so the ONLY 404 is the Allsky — proving that a
      // missing Allsky degrades gracefully and does NOT surface as a hard error.
      return route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: solid(8, 8, [200, 200, 210]) });
    });

    await page.goto('/#ra=62&dec=-37&z=1&base=dss'); // wide view → order-1 is the ancestor

    // The Allsky 404 triggers the order-1 sweep (48 tiles cover the sky).
    await expect.poll(() => order1Reqs.size, { timeout: 15000 }).toBeGreaterThan(24);
    expect(allskyReqs.length).toBe(1); // the single Allsky WAS attempted first

    // The scene is non-black, and the Allsky 404 never surfaces as a hard error
    // (it is only a backdrop; the sharp tiles carry the image).
    const [r, g, b] = await centreRgb(page);
    expect(r + g + b).toBeGreaterThan(60);
    await expect(page.locator('.error-overlay')).toHaveCount(0);
  });
});
