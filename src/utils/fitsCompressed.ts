/**
 * Tile-compressed FITS image reader (the FITS "compressed image" convention,
 * ZIMAGE) — needed because the RSP SODA cutout service returns DP1 cutouts as a
 * MULTI-EXTENSION FITS whose primary HDU is EMPTY (NAXIS=0) and whose image lives
 * in a `BINTABLE` extension named `IMAGE`, GZIP-tile-compressed (ZCMPTYPE GZIP_2).
 * The plain-primary `readFits` (src/utils/fits.ts) throws "NAXIS=0" on these — so
 * every live DP1 cutout / RGB composite was unreadable. VALIDATED against a real
 * captured cutout (tests/fixtures/dp1-deep-coadd-cutout.fits).
 *
 * Supports the DP1 case (GZIP_1 / GZIP_2, float/int ZBITPIX) and falls back to the
 * plain-image `readFits` when the primary HDU already holds a 2-D image. Throws an
 * HONEST, specific error for an unsupported compression (e.g. RICE) rather than a
 * cryptic misread. Async because gunzip uses the streaming `DecompressionStream`
 * (a Web API present in the browser and the Node/jsdom test env).
 */

import { readFits, type FitsImage, type FitsHeader } from './fits.js';

const BLOCK = 2880;
const CARD = 80;
const CARDS_PER_BLOCK = 36;

type Cards = Record<string, string | number>;

/** Parse a FITS header starting at `off`; returns the cards + the offset where its
 *  data unit begins (next 2880-byte boundary after END). */
function parseCards(bytes: Uint8Array, off: number): { cards: Cards; dataOffset: number } {
  const cards: Cards = {};
  const decoder = new TextDecoder('ascii');
  let o = off;
  for (;;) {
    for (let i = 0; i < CARDS_PER_BLOCK; i++) {
      const card = decoder.decode(bytes.subarray(o + i * CARD, o + i * CARD + CARD));
      const key = card.slice(0, 8).trim();
      if (key === 'END') {
        return { cards, dataOffset: o + BLOCK };
      }
      if (card[8] === '=') {
        let val = card.slice(9);
        const slash = val.indexOf('/');
        if (slash >= 0) val = val.slice(0, slash);
        val = val.trim();
        if (val.startsWith("'")) {
          cards[key] = val.replace(/^'|'$/g, '').trim();
        } else {
          const num = Number(val);
          cards[key] = Number.isFinite(num) && val !== '' ? num : val;
        }
      }
    }
    o += BLOCK;
  }
}

/** Bytes the data unit of an HDU occupies (rounded up to a 2880 boundary). */
function dataUnitBytes(cards: Cards): number {
  const naxis = Number(cards.NAXIS ?? 0);
  if (naxis === 0) return 0;
  const bitpix = Math.abs(Number(cards.BITPIX ?? 8)) / 8;
  const gcount = Number(cards.GCOUNT ?? 1);
  const pcount = Number(cards.PCOUNT ?? 0);
  let n = 1;
  for (let a = 1; a <= naxis; a++) n *= Number(cards[`NAXIS${a}`] ?? 1);
  const raw = bitpix * gcount * (pcount + n);
  return Math.ceil(raw / BLOCK) * BLOCK;
}

/** gunzip via the streaming Web API (browser + Node 18+/jsdom). Uses the stream's
 *  writer/reader directly — jsdom's Blob has no `.stream()`, so we don't rely on it. */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Read one pixel of ZBITPIX type at byte `p` (big-endian) → Number. */
function readZ(dv: DataView, p: number, zbitpix: number): number {
  switch (zbitpix) {
    case 8:
      return dv.getUint8(p);
    case 16:
      return dv.getInt16(p);
    case 32:
      return dv.getInt32(p);
    case -32:
      return dv.getFloat32(p);
    case -64:
      return dv.getFloat64(p);
    default:
      throw new Error(`tile FITS: unsupported ZBITPIX ${zbitpix}`);
  }
}

/**
 * Reverse the GZIP_2 byte shuffle: the uncompressed tile is stored as
 * [all byte0s][all byte1s]… per element; de-interleave into element order.
 * GZIP_1 is unshuffled (returned as-is).
 */
function unshuffle(bytes: Uint8Array, elemBytes: number, nElem: number): Uint8Array {
  if (elemBytes <= 1) return bytes;
  const out = new Uint8Array(nElem * elemBytes);
  for (let e = 0; e < elemBytes; e++) {
    for (let i = 0; i < nElem; i++) out[i * elemBytes + e] = bytes[e * nElem + i]!;
  }
  return out;
}

/** Build a FitsHeader (WCS-bearing subset) from the compressed extension's cards. */
function headerFromCards(cards: Cards, width: number, height: number): FitsHeader {
  const num = (k: string): number | undefined =>
    typeof cards[k] === 'number' ? (cards[k] as number) : undefined;
  return {
    simple: true,
    cards,
    bitpix: Number(cards.ZBITPIX ?? -32),
    naxis: 2,
    naxis1: width,
    naxis2: height,
    bscale: num('BSCALE') ?? 1,
    bzero: num('BZERO') ?? 0,
    crval1: num('CRVAL1'),
    crval2: num('CRVAL2'),
    crpix1: num('CRPIX1'),
    crpix2: num('CRPIX2'),
    cd1_1: num('CD1_1'),
    cd1_2: num('CD1_2'),
    cd2_1: num('CD2_1'),
    cd2_2: num('CD2_2'),
    cdelt1: num('CDELT1'),
    cdelt2: num('CDELT2'),
    ctype1: typeof cards.CTYPE1 === 'string' ? (cards.CTYPE1 as string) : undefined,
    ctype2: typeof cards.CTYPE2 === 'string' ? (cards.CTYPE2 as string) : undefined,
    bunit: typeof cards.BUNIT === 'string' ? (cards.BUNIT as string) : undefined,
  };
}

/** Decode a ZIMAGE (tile-compressed) BINTABLE extension into a FitsImage. */
async function decodeZImage(
  bytes: Uint8Array,
  cards: Cards,
  dataOffset: number
): Promise<FitsImage> {
  const cmp = String(cards.ZCMPTYPE ?? '');
  if (cmp !== 'GZIP_1' && cmp !== 'GZIP_2') {
    throw new Error(
      `DP1 cutout uses ${cmp || 'an unknown'} FITS tile compression, which this ` +
        `viewer cannot decode yet (supported: GZIP_1, GZIP_2).`
    );
  }
  const zbitpix = Number(cards.ZBITPIX);
  const elemBytes = Math.abs(zbitpix) / 8;
  const width = Number(cards.ZNAXIS1);
  const height = Number(cards.ZNAXIS2);
  const tileW = Number(cards.ZTILE1 ?? width);
  const tileH = Number(cards.ZTILE2 ?? 1);
  const nTilesX = Math.ceil(width / tileW);
  const rowBytes = Number(cards.NAXIS1); // BINTABLE row width (the P-descriptors)
  const nRows = Number(cards.NAXIS2); // one compressed tile per row
  const heapStart = dataOffset + rowBytes * nRows + Number(cards.THEAP ?? 0);

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float64Array(width * height);

  for (let t = 0; t < nRows; t++) {
    // TFORM '1PB' → an 8-byte descriptor: int32 count, int32 heap byte-offset.
    const desc = dataOffset + t * rowBytes;
    const nBytes = dv.getInt32(desc);
    const heapOff = dv.getInt32(desc + 4);
    const comp = bytes.subarray(heapStart + heapOff, heapStart + heapOff + nBytes);
    const gunzipped = await gunzip(comp);

    const tileX = (t % nTilesX) * tileW;
    const tileY = Math.floor(t / nTilesX) * tileH;
    const tw = Math.min(tileW, width - tileX);
    const th = Math.min(tileH, height - tileY);
    const nPix = tw * th;

    const raw = cmp === 'GZIP_2' ? unshuffle(gunzipped, elemBytes, nPix) : gunzipped;
    const tdv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let py = 0; py < th; py++) {
      for (let px = 0; px < tw; px++) {
        const v = readZ(tdv, (py * tw + px) * elemBytes, zbitpix);
        out[(tileY + py) * width + (tileX + px)] = v;
      }
    }
  }

  return { header: headerFromCards(cards, width, height), width, height, data: out };
}

/**
 * Read a FITS image from a buffer that may be a plain primary-HDU image OR a
 * multi-extension file whose image is tile-compressed (the DP1 SODA cutout).
 * Returns the FIRST readable image. Async (gunzip is streaming).
 */
export async function readFitsImageAsync(buffer: ArrayBuffer): Promise<FitsImage> {
  const bytes = new Uint8Array(buffer);
  // Fast path: a plain 2-D primary image → the existing synchronous reader.
  const primary = parseCards(bytes, 0);
  if (Number(primary.cards.NAXIS ?? 0) >= 2 && primary.cards.ZIMAGE !== 'T') {
    return readFits(buffer);
  }

  // Walk the HDUs looking for an image (tile-compressed ZIMAGE, or a plain image
  // extension). The primary here is typically empty (NAXIS=0).
  let off = primary.dataOffset + dataUnitBytes(primary.cards);
  const seen: string[] = [];
  while (off + BLOCK <= bytes.length) {
    const { cards, dataOffset } = parseCards(bytes, off);
    seen.push(String(cards.EXTNAME ?? cards.XTENSION ?? '?'));
    if (cards.ZIMAGE === 'T') {
      return decodeZImage(bytes, cards, dataOffset);
    }
    if (Number(cards.NAXIS ?? 0) >= 2 && cards.XTENSION === 'IMAGE') {
      // A plain image extension: slice it out and reuse readFits on a sub-buffer.
      const sub = buffer.slice(off);
      return readFits(sub);
    }
    off = dataOffset + dataUnitBytes(cards);
  }
  throw new Error(
    `FITS has no readable image HDU (primary NAXIS=${Number(primary.cards.NAXIS ?? 0)}; ` +
      `extensions: ${seen.join(', ') || 'none'}).`
  );
}
