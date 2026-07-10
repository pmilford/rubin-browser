import { describe, it, expect } from 'vitest';
import { readFits, minMax, percentileClip } from '../../src/utils/fits.js';

/**
 * Ground-truth FITS tests. The whole point (per CLAUDE.md's adversarial rule) is
 * that we BUILD synthetic FITS buffers with KNOWN pixel values and assert the
 * exact physical values come back — so a little-endian bug, an ignored
 * BSCALE/BZERO, a transposed row/col, or a swallowed error all FAIL.
 *
 * Each test names the broken implementation its assertions kill.
 */

const BLOCK = 2880;
const CARD = 80;

/** Build a single 80-char header card, space-padded. Throws if too long. */
function card(text: string): string {
  if (text.length > CARD) throw new Error(`card too long: "${text}"`);
  return text.padEnd(CARD, ' ');
}

/** Build a value card "KEYWORD = value / comment", FITS-style column layout. */
function valueCard(keyword: string, value: string): string {
  // Keyword in cols 1-8, "= " in cols 9-10, value right-aligned-ish after.
  const kw = keyword.padEnd(8, ' ').slice(0, 8);
  return card(`${kw}= ${value}`);
}

/** Assemble header cards + END, padded to a whole 2880-byte block. */
function buildHeaderBytes(cards: string[]): Uint8Array {
  const all = [...cards, card('END')];
  let text = all.join('');
  // Pad the header out to a multiple of 2880 bytes with spaces.
  const blocks = Math.ceil(text.length / BLOCK);
  text = text.padEnd(blocks * BLOCK, ' ');
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/**
 * Build a complete FITS ArrayBuffer for a 2D image.
 * `write(view, offset, value)` writes one BIG-ENDIAN raw pixel; pixels are
 * supplied row-major (row 0 first) so we control exact byte order + ordering.
 */
function buildFits(
  extraCards: string[],
  bitpix: number,
  width: number,
  height: number,
  rawPixels: number[],
  write: (view: DataView, offset: number, value: number) => void,
  bytesPerPixel: number
): ArrayBuffer {
  const cards = [
    valueCard('SIMPLE', 'T'),
    valueCard('BITPIX', String(bitpix)),
    valueCard('NAXIS', '2'),
    valueCard('NAXIS1', String(width)),
    valueCard('NAXIS2', String(height)),
    ...extraCards,
  ];
  const header = buildHeaderBytes(cards);

  const dataBytes = rawPixels.length * bytesPerPixel;
  const dataBlocks = Math.ceil(dataBytes / BLOCK);
  const buffer = new ArrayBuffer(header.length + dataBlocks * BLOCK);
  new Uint8Array(buffer).set(header, 0);

  const view = new DataView(buffer, header.length);
  for (let i = 0; i < rawPixels.length; i++) {
    write(view, i * bytesPerPixel, rawPixels[i]!);
  }
  return buffer;
}

describe('readFits — geometry and dimensions', () => {
  it('recovers width/height and does NOT transpose (kills wrong row/col order)', () => {
    // 3 wide x 2 tall. Raw value encodes row*10+col so a transpose is obvious.
    // Row 0: 0,1,2   Row 1: 10,11,12
    const raw = [0, 1, 2, 10, 11, 12];
    const buf = buildFits([], 32, 3, 2, raw, (v, o, x) => v.setInt32(o, x), 4);
    const img = readFits(buf);

    expect(img.width).toBe(3);
    expect(img.height).toBe(2);
    expect(img.data.length).toBe(6);
    // Row-major, row 0 first. A transposed reader would give [0,10,1,11,2,12].
    expect(Array.from(img.data)).toEqual([0, 1, 2, 10, 11, 12]);
    // Pixel (row=1,col=2) sits at index row*width+col = 5.
    expect(img.data[1 * 3 + 2]).toBe(12);
  });
});

describe('readFits — BITPIX 8 (uint8)', () => {
  it('reads unsigned bytes exactly', () => {
    const raw = [0, 1, 127, 255, 200, 42, 3, 9, 250, 128, 64, 32, 16, 8, 4, 2];
    const buf = buildFits([], 8, 4, 4, raw, (v, o, x) => v.setUint8(o, x), 1);
    const img = readFits(buf);
    expect(Array.from(img.data)).toEqual(raw);
  });
});

describe('readFits — BITPIX 16 (int16) with a signed value', () => {
  it('reads big-endian signed 16-bit (kills a little-endian reader)', () => {
    // 0x0100 big-endian = 256. A little-endian reader would read 0x0001 = 1.
    const raw = [256, -1, 1000, -1000];
    const buf = buildFits([], 16, 2, 2, raw, (v, o, x) => v.setInt16(o, x), 2);
    const img = readFits(buf);
    expect(img.data[0]).toBe(256); // NOT 1 → big-endian confirmed
    expect(img.data[1]).toBe(-1);
    expect(img.data[2]).toBe(1000);
    expect(img.data[3]).toBe(-1000);
  });
});

describe('readFits — BITPIX 16 with BSCALE/BZERO', () => {
  it('applies physical = BSCALE*raw + BZERO (kills BSCALE-ignored impl)', () => {
    // Classic unsigned-16 packing: BZERO=32768, BSCALE=1 stored as int16.
    // Also a non-unit BSCALE to catch "ignored scale" bugs.
    const raw = [0, 100, -100, 500];
    const buf = buildFits(
      [valueCard('BSCALE', '2.5'), valueCard('BZERO', '100.0')],
      16,
      2,
      2,
      raw,
      (v, o, x) => v.setInt16(o, x),
      2
    );
    const img = readFits(buf);
    // physical = 2.5*raw + 100
    expect(img.data[0]).toBeCloseTo(100); // 2.5*0+100
    expect(img.data[1]).toBeCloseTo(350); // 2.5*100+100
    expect(img.data[2]).toBeCloseTo(-150); // 2.5*-100+100
    expect(img.data[3]).toBeCloseTo(1350); // 2.5*500+100
    expect(img.header.bscale).toBe(2.5);
    expect(img.header.bzero).toBe(100);
  });

  it('defaults BSCALE=1, BZERO=0 when absent', () => {
    const raw = [5, 6, 7, 8];
    const buf = buildFits([], 16, 2, 2, raw, (v, o, x) => v.setInt16(o, x), 2);
    const img = readFits(buf);
    expect(img.header.bscale).toBe(1);
    expect(img.header.bzero).toBe(0);
    expect(Array.from(img.data)).toEqual(raw);
  });
});

describe('readFits — BITPIX -32 (float32)', () => {
  it('reads big-endian IEEE floats with a known gradient + peak', () => {
    // 4x4 gradient with a known bright peak at (row=1,col=2)=999.5.
    const raw = [
      0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 999.5, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5,
    ];
    const buf = buildFits([], -32, 4, 4, raw, (v, o, x) => v.setFloat32(o, x), 4);
    const img = readFits(buf);
    for (let i = 0; i < raw.length; i++) {
      expect(img.data[i]).toBeCloseTo(raw[i]!, 4);
    }
    // Peak is at row*width+col = 1*4+2 = 6 (kills transpose + endian bugs).
    expect(img.data[6]).toBeCloseTo(999.5, 4);
    expect(minMax(img.data).max).toBeCloseTo(999.5, 4);
  });

  it('flags float NaN pixels as NaN', () => {
    const raw = [1.0, NaN, 3.0, 4.0];
    const buf = buildFits([], -32, 2, 2, raw, (v, o, x) => v.setFloat32(o, x), 4);
    const img = readFits(buf);
    expect(img.data[0]).toBe(1);
    expect(Number.isNaN(img.data[1])).toBe(true);
    expect(img.data[2]).toBe(3);
  });
});

describe('readFits — BITPIX -64 (float64)', () => {
  it('reads big-endian double precision exactly', () => {
    const raw = [3.141592653589793, -2.718281828459045, 1e10, -1e-10];
    const buf = buildFits([], -64, 2, 2, raw, (v, o, x) => v.setFloat64(o, x), 8);
    const img = readFits(buf);
    expect(img.data[0]).toBe(3.141592653589793);
    expect(img.data[1]).toBe(-2.718281828459045);
    expect(img.data[2]).toBe(1e10);
    expect(img.data[3]).toBe(-1e-10);
  });
});

describe('readFits — BITPIX 32 (int32)', () => {
  it('reads big-endian 32-bit ints (kills little-endian)', () => {
    // 0x00010000 big-endian = 65536; little-endian would read 0x00000100 = 256.
    const raw = [65536, -65536, 2147483647, -2147483648];
    const buf = buildFits([], 32, 2, 2, raw, (v, o, x) => v.setInt32(o, x), 4);
    const img = readFits(buf);
    expect(img.data[0]).toBe(65536);
    expect(img.data[1]).toBe(-65536);
    expect(img.data[2]).toBe(2147483647);
    expect(img.data[3]).toBe(-2147483648);
  });
});

describe('readFits — BLANK handling (integer types)', () => {
  it('maps raw==BLANK to NaN, before BSCALE/BZERO', () => {
    const raw = [10, -32768, 30, 40];
    const buf = buildFits(
      [valueCard('BLANK', '-32768'), valueCard('BSCALE', '2.0'), valueCard('BZERO', '5.0')],
      16,
      2,
      2,
      raw,
      (v, o, x) => v.setInt16(o, x),
      2
    );
    const img = readFits(buf);
    expect(img.data[0]).toBeCloseTo(25); // 2*10+5
    expect(Number.isNaN(img.data[1])).toBe(true); // BLANK → NaN, not 2*-32768+5
    expect(img.data[2]).toBeCloseTo(65); // 2*30+5
    expect(img.header.blank).toBe(-32768);
  });
});

describe('readFits — header pass-through', () => {
  it('parses and promotes optional WCS/provenance keywords', () => {
    const buf = buildFits(
      [
        valueCard('OBJECT', "'M42     '"),
        valueCard('BUNIT', "'nJy     '"),
        valueCard('CRVAL1', '83.8221'),
        valueCard('CRVAL2', '-5.3911'),
        valueCard('CRPIX1', '50.0'),
        valueCard('CRPIX2', '50.0'),
        valueCard('CDELT1', '-5.55e-05'),
        valueCard('CDELT2', '5.55e-05'),
        valueCard('CTYPE1', "'RA---TAN'"),
        valueCard('CTYPE2', "'DEC--TAN'"),
      ],
      -32,
      2,
      2,
      [1, 2, 3, 4],
      (v, o, x) => v.setFloat32(o, x),
      4
    );
    const img = readFits(buf);
    expect(img.header.object).toBe('M42');
    expect(img.header.bunit).toBe('nJy');
    expect(img.header.crval1).toBeCloseTo(83.8221);
    expect(img.header.crval2).toBeCloseTo(-5.3911);
    expect(img.header.crpix1).toBe(50);
    expect(img.header.cdelt1).toBeCloseTo(-5.55e-5);
    expect(img.header.ctype1).toBe('RA---TAN');
    expect(img.header.ctype2).toBe('DEC--TAN');
    // Raw cards map keeps everything too.
    expect(img.header.cards.CTYPE1).toBe('RA---TAN');
  });
});

describe('readFits — error handling (never silently return zeros)', () => {
  it('throws on a non-FITS buffer (bad first keyword)', () => {
    const junk = new Uint8Array(BLOCK);
    junk.fill(0x41); // "AAAA..."
    expect(() => readFits(junk.buffer)).toThrow(/FITS/);
  });

  it('throws on a buffer smaller than one header block', () => {
    const tiny = new ArrayBuffer(100);
    expect(() => readFits(tiny)).toThrow(/FITS/);
  });

  it('throws on an unsupported BITPIX', () => {
    // BITPIX=64 (int64) is not in the supported set.
    const buf = buildFits([], 64, 1, 1, [0], (v, o, x) => v.setUint8(o, x), 1);
    expect(() => readFits(buf)).toThrow(/BITPIX/);
  });

  it('throws when the data array is truncated', () => {
    // Declare 4x4 but only supply a header (no data block).
    const header = buildHeaderBytes([
      valueCard('SIMPLE', 'T'),
      valueCard('BITPIX', '-32'),
      valueCard('NAXIS', '2'),
      valueCard('NAXIS1', '4'),
      valueCard('NAXIS2', '4'),
    ]);
    expect(() => readFits(header.buffer)).toThrow(/[Tt]runcated/);
  });
});

describe('minMax — ignores NaN', () => {
  it('skips NaN and returns finite extremes', () => {
    const data = new Float64Array([5, NaN, -2, 100, NaN, 3]);
    expect(minMax(data)).toEqual({ min: -2, max: 100 });
  });

  it('returns NaN/NaN for an all-NaN array (no silent zeros)', () => {
    const data = new Float64Array([NaN, NaN]);
    const { min, max } = minMax(data);
    expect(Number.isNaN(min)).toBe(true);
    expect(Number.isNaN(max)).toBe(true);
  });
});

describe('percentileClip — ignores NaN, sane stretch bounds', () => {
  it('returns values at the requested percentiles', () => {
    // 0..99 plus a couple NaNs the clip must ignore.
    const arr = new Float64Array(102);
    for (let i = 0; i < 100; i++) arr[i] = i;
    arr[100] = NaN;
    arr[101] = NaN;
    const { min, max } = percentileClip(arr, 0, 100);
    expect(min).toBe(0);
    expect(max).toBe(99);
    const clipped = percentileClip(arr, 1, 99);
    expect(clipped.min).toBeGreaterThan(0);
    expect(clipped.max).toBeLessThan(99);
  });

  it('is robust to outliers (clip excludes a lone spike)', () => {
    const arr = new Float64Array(101);
    for (let i = 0; i < 100; i++) arr[i] = 10;
    arr[100] = 1e6; // saturated spike
    const { max } = percentileClip(arr, 0.5, 99);
    expect(max).toBe(10); // 99th percentile excludes the single spike
  });
});
