import { describe, it, expect } from 'vitest';
import {
  encodeState,
  decodeState,
  readStateFromUrl,
  applyStateToUrl,
  type ViewPermalink,
} from '../../src/utils/urlState.js';

/**
 * Adversarial permalink tests. Each block names the broken implementation it
 * kills, per the design spec. The recurring nightmare is a `Number(x) || 0`
 * decoder that silently teleports the user to (0,0).
 */

const fullRubin: ViewPermalink = {
  ra: 150.12,
  dec: 2.2,
  zoom: 8,
  base: 'rubin',
  rubinDataset: 'color_gri',
  scaling: 'asinh',
  colorMap: 'viridis',
  invert: true,
  overlays: ['gaia', 'dss2'],
};

const fullOffline: ViewPermalink = {
  ra: 62,
  dec: -37,
  zoom: 3,
  base: 'offline',
  rubinDataset: 'band_r',
  scaling: 'linear',
  colorMap: 'grayscale',
  invert: false,
  overlays: [],
  offlineBand: 'g',
  offlineEpoch: 5,
};

const minimal: ViewPermalink = {
  ra: 0,
  dec: 0,
  zoom: 0,
  base: 'auto',
  rubinDataset: 'color_gri',
  scaling: 'log',
  colorMap: 'inferno',
};

describe('round-trip (kills a lossy/asymmetric encoder-decoder pair)', () => {
  // A decoder that dropped invert=false, or an encoder that omitted empty
  // overlays, would fail these deep-equal checks.
  it('round-trips a full Rubin state', () => {
    expect(decodeState(encodeState(fullRubin))).toEqual(fullRubin);
  });

  it('round-trips a full offline state with band + epoch', () => {
    expect(decodeState(encodeState(fullOffline))).toEqual(fullOffline);
  });

  it('round-trips a minimal state (no optional keys present)', () => {
    expect(decodeState(encodeState(minimal))).toEqual(minimal);
  });

  it('round-trips invert=false explicitly (not dropped as falsy)', () => {
    const s: ViewPermalink = { ...minimal, invert: false };
    const decoded = decodeState(encodeState(s));
    expect(decoded.invert).toBe(false);
    expect(decoded).toEqual(s);
  });

  it('round-trips an empty overlays array (explicit, not omitted)', () => {
    const s: ViewPermalink = { ...minimal, overlays: [] };
    const decoded = decodeState(encodeState(s));
    expect(decoded.overlays).toEqual([]);
    expect(decoded).toEqual(s);
  });
});

describe('ra/dec precision (kills a 15-digit or non-rounding encoder)', () => {
  it('encodes ra with <= 6 decimals', () => {
    const hash = encodeState({ ...minimal, ra: 150.123456789 });
    const raStr = new URLSearchParams(hash).get('ra')!;
    const decimals = raStr.split('.')[1] ?? '';
    expect(decimals.length).toBeLessThanOrEqual(6);
  });

  it('decodes back within 1e-5 of the original', () => {
    const hash = encodeState({ ...minimal, ra: 150.123456789, dec: -12.987654321 });
    const decoded = decodeState(hash);
    expect(decoded.ra!).toBeCloseTo(150.123456789, 5);
    expect(decoded.dec!).toBeCloseTo(-12.987654321, 5);
  });
});

describe('garbage rejection (kills a Number(x)||0 / default-coercing decoder)', () => {
  // The killer test: every value is garbage. A decoder that coerces would
  // return ra:0, dec:0, zoom:0, base:'auto', cmap:default — teleporting the
  // user to the celestial origin. We demand those keys be ABSENT.
  it('drops every invalid key, returning {}', () => {
    const decoded = decodeState('#ra=foo&dec=&z=abc&base=martian&cmap=notacmap');
    expect(decoded).toEqual({});
  });

  it('specifically omits ra/dec/zoom/base/cmap (not 0 / auto / default)', () => {
    const decoded = decodeState('#ra=foo&dec=&z=abc&base=martian&cmap=notacmap');
    expect('ra' in decoded).toBe(false);
    expect('dec' in decoded).toBe(false);
    expect('zoom' in decoded).toBe(false);
    expect('base' in decoded).toBe(false);
    expect('colorMap' in decoded).toBe(false);
  });

  it('drops an empty dec rather than reading Number("") as 0', () => {
    const decoded = decodeState('#dec=');
    expect(decoded.dec).toBeUndefined();
    expect(decoded).toEqual({});
  });

  it('never throws on assorted garbage', () => {
    expect(() => decodeState('#=&&&==&ra=%%%&z=NaN&dec=Infinity')).not.toThrow();
    const decoded = decodeState('#=&&&==&ra=%%%&z=NaN&dec=Infinity');
    // ra=%%% -> non-numeric drop; z=NaN -> drop; dec=Infinity -> not finite drop.
    expect(decoded).toEqual({});
  });
});

describe('numeric-but-out-of-range is repaired, not dropped', () => {
  // Distinguishes "non-numeric -> drop" from "numeric but out of range ->
  // wrap/clamp". A decoder that dropped 370 (instead of wrapping) or clamped a
  // non-number to a bound would fail here.
  it('wraps ra >= 360 into [0, 360)', () => {
    expect(decodeState('#ra=370').ra).toBeCloseTo(10, 6);
    expect(decodeState('#ra=360').ra).toBeCloseTo(0, 6);
    expect(decodeState('#ra=-10').ra).toBeCloseTo(350, 6);
  });

  it('clamps dec outside [-90, 90]', () => {
    expect(decodeState('#dec=120').dec).toBe(90);
    expect(decodeState('#dec=-120').dec).toBe(-90);
  });
});

describe('partial decode (kills a decoder that invents defaults for absent keys)', () => {
  it('returns exactly {dec:2.2} for a lone dec', () => {
    expect(decodeState('#dec=2.2')).toEqual({ dec: 2.2 });
  });

  it('returns only the present valid keys', () => {
    expect(decodeState('#z=7&scale=sqrt')).toEqual({ zoom: 7, scaling: 'sqrt' });
  });
});

describe('enum validation (kills a decoder that passes any string through)', () => {
  it('drops an out-of-set base but keeps a valid one', () => {
    expect(decodeState('#base=martian').base).toBeUndefined();
    expect(decodeState('#base=rubin').base).toBe('rubin');
    expect(decodeState('#base=offline').base).toBe('offline');
  });

  it('drops an out-of-set scale but keeps a valid one', () => {
    expect(decodeState('#scale=bogus').scaling).toBeUndefined();
    expect(decodeState('#scale=asinh').scaling).toBe('asinh');
  });

  it('drops an out-of-set cmap but keeps a valid one', () => {
    expect(decodeState('#cmap=notacmap').colorMap).toBeUndefined();
    expect(decodeState('#cmap=plasma').colorMap).toBe('plasma');
  });

  it('drops an out-of-set offline band but keeps a valid one', () => {
    expect(decodeState('#band=q').offlineBand).toBeUndefined();
    expect(decodeState('#band=z').offlineBand).toBe('z');
  });

  it('splits/joins overlays and round-trips the empty case', () => {
    expect(decodeState('#ov=gaia,dss2').overlays).toEqual(['gaia', 'dss2']);
    expect(decodeState('#ov=').overlays).toEqual([]);
    expect(decodeState(encodeState({ ...minimal, overlays: ['a', 'b', 'c'] })).overlays).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('drops an invalid invert flag but reads 0/1', () => {
    expect(decodeState('#inv=yes').invert).toBeUndefined();
    expect(decodeState('#inv=1').invert).toBe(true);
    expect(decodeState('#inv=0').invert).toBe(false);
  });
});

describe('leading-char tolerance (kills a decoder hard-wired to one prefix)', () => {
  it('accepts a leading "#"', () => {
    expect(decodeState('#z=8').zoom).toBe(8);
  });

  it('accepts a leading "?"', () => {
    expect(decodeState('?z=8').zoom).toBe(8);
  });

  it('accepts a bare body', () => {
    expect(decodeState('z=8').zoom).toBe(8);
  });

  it('all three prefixes decode identically', () => {
    const hash = encodeState(fullRubin);
    expect(decodeState('#' + hash)).toEqual(decodeState('?' + hash));
    expect(decodeState('?' + hash)).toEqual(decodeState(hash));
  });
});

describe('unknown keys are ignored', () => {
  it('skips keys not in the schema', () => {
    expect(decodeState('#z=8&bogus=whatever&nested=a=b')).toEqual({ zoom: 8 });
  });

  it('returns {} for empty / prefix-only input', () => {
    expect(decodeState('')).toEqual({});
    expect(decodeState('#')).toEqual({});
    expect(decodeState('?')).toEqual({});
  });
});

describe('impure wrappers (trivial guard-does-not-throw only; no jsdom location asserts)', () => {
  it('readStateFromUrl returns an object without throwing', () => {
    expect(() => readStateFromUrl()).not.toThrow();
    expect(typeof readStateFromUrl()).toBe('object');
  });

  it('applyStateToUrl does not throw', () => {
    expect(() => applyStateToUrl(fullRubin)).not.toThrow();
  });
});
