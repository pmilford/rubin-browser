import { describe, it, expect, vi } from 'vitest';
import {
  isBitmap,
  tileReady,
  tileWidth,
  tileHeight,
  closeTile,
  type DecodedTile,
} from '../../src/utils/decodedTile.js';

// The renderer caches EITHER an <img> or an ImageBitmap and must treat them
// uniformly. jsdom defines neither `ImageBitmap` nor a loading `<img>`, so these
// tests use structural stand-ins that match the REAL shape of each type:
//   - <img>:        has `naturalWidth`/`naturalHeight`/`complete`
//   - ImageBitmap:  has `width`/`height`/`close`, NO `naturalWidth`
// which is exactly what the duck-typed helpers key on.

function fakeImg(opts: { complete?: boolean; naturalWidth?: number; naturalHeight?: number } = {}): DecodedTile {
  return {
    complete: opts.complete ?? true,
    naturalWidth: opts.naturalWidth ?? 512,
    naturalHeight: opts.naturalHeight ?? 512,
  } as unknown as DecodedTile;
}

function fakeBitmap(width = 512, height = 512, close = vi.fn()): DecodedTile {
  return { width, height, close } as unknown as DecodedTile;
}

describe('isBitmap', () => {
  it('classifies an ImageBitmap (no naturalWidth) as a bitmap', () => {
    expect(isBitmap(fakeBitmap())).toBe(true);
  });
  it('classifies an HTMLImageElement (has naturalWidth) as NOT a bitmap', () => {
    expect(isBitmap(fakeImg())).toBe(false);
    // A broken duck-type that keyed on `width` would misclassify the <img> here,
    // because a loaded <img> also exposes a width — this asserts we key on
    // naturalWidth, the property only <img> has.
  });
});

describe('tileReady', () => {
  it('is false for null/undefined', () => {
    expect(tileReady(null)).toBe(false);
    expect(tileReady(undefined)).toBe(false);
  });
  it('is true for a fully-loaded <img>', () => {
    expect(tileReady(fakeImg({ complete: true, naturalWidth: 512 }))).toBe(true);
  });
  it('is false for an <img> that is still loading (not complete / 0 width)', () => {
    expect(tileReady(fakeImg({ complete: false, naturalWidth: 512 }))).toBe(false);
    expect(tileReady(fakeImg({ complete: true, naturalWidth: 0 }))).toBe(false);
  });
  it('is true for a live ImageBitmap and false for a CLOSED one (width 0)', () => {
    expect(tileReady(fakeBitmap(512, 512))).toBe(true);
    // close() zeroes an ImageBitmap's dimensions — a freed bitmap must not draw.
    expect(tileReady(fakeBitmap(0, 0))).toBe(false);
  });
});

describe('tileWidth / tileHeight', () => {
  it('reads the intrinsic dimensions of an ImageBitmap', () => {
    const b = fakeBitmap(256, 128);
    expect(tileWidth(b, 999)).toBe(256);
    expect(tileHeight(b, 999)).toBe(128);
  });
  it('reads naturalWidth/Height of an <img>', () => {
    const i = fakeImg({ naturalWidth: 300, naturalHeight: 200 });
    expect(tileWidth(i, 999)).toBe(300);
    expect(tileHeight(i, 999)).toBe(200);
  });
  it('falls back when an <img> reports 0 (unmeasured)', () => {
    const i = fakeImg({ naturalWidth: 0, naturalHeight: 0 });
    expect(tileWidth(i, 512)).toBe(512);
    expect(tileHeight(i, 512)).toBe(512);
  });
});

describe('closeTile', () => {
  it('calls close() on an ImageBitmap (frees decoder memory)', () => {
    const close = vi.fn();
    closeTile(fakeBitmap(512, 512, close));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('is a no-op for an <img> (nothing to free) and for null', () => {
    expect(() => closeTile(fakeImg())).not.toThrow();
    expect(() => closeTile(null)).not.toThrow();
    expect(() => closeTile(undefined)).not.toThrow();
  });
});
