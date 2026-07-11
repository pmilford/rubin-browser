/**
 * Adversarial tests for the DS9 region parser/serializer.
 *
 * These assert OUTCOMES against ground truth, not self-consistency:
 *  - a REAL fk5 file (circle radius in arcsec + a polygon) parses to the exact
 *    shape types with sky coords in DEGREES and the arcsec radius CONVERTED
 *    (30" → 30/3600 deg), so a unit-ignoring impl (leaves "30") fails, and a
 *    shape-dropping impl (loses the polygon) fails;
 *  - serialize → parse round-trips numerically and is byte-idempotent;
 *  - an unknown shape is skipped, not thrown on;
 *  - a malformed line never throws and never fabricates a region.
 */

import { describe, it, expect } from 'vitest';
import { parseDs9, serializeDs9, type Ds9Region } from '../../src/utils/ds9Regions.js';

// A realistic DS9 export: header + fk5 system + circle (arcsec radius) + polygon.
const SAMPLE = `# Region file format: DS9 version 4.0
global color=green dashlist=8 3 width=1 font="helvetica 10 normal roman"
fk5
circle(202.469575,47.195258,30") # color=red text={Whirlpool}
polygon(10.0,20.0,10.1,20.0,10.05,20.1)
`;

describe('parseDs9', () => {
  it('parses a real fk5 file: exact shape types, degrees, arcsec→deg radius', () => {
    const regions = parseDs9(SAMPLE);
    expect(regions).toHaveLength(2);

    const circle = regions[0]!;
    expect(circle.shape).toBe('circle');
    if (circle.shape !== 'circle') throw new Error('type');
    expect(circle.frame).toBe('icrs');
    // Coordinates are DEGREES (decimal in fk5), preserved as-is.
    expect(circle.x).toBeCloseTo(202.469575, 6);
    expect(circle.y).toBeCloseTo(47.195258, 6);
    // The 30" radius MUST be converted to degrees — this is the load-bearing
    // assertion a unit-ignoring parser (leaves 30) fails.
    expect(circle.r).toBeCloseTo(30 / 3600, 9);
    expect(circle.r).not.toBeCloseTo(30, 3);

    const poly = regions[1]!;
    expect(poly.shape).toBe('polygon');
    if (poly.shape !== 'polygon') throw new Error('type');
    expect(poly.points).toHaveLength(3);
    expect(poly.points[0]).toEqual({ x: 10.0, y: 20.0 });
    expect(poly.points[2]).toEqual({ x: 10.05, y: 20.1 });
  });

  it('converts arcmin (\'), radians (r), and bare-degree lengths correctly', () => {
    const regions = parseDs9(
      'icrs\ncircle(10,20,3\')\ncircle(10,20,0.5)\nellipse(10,20,1d,2d,45)'
    );
    expect(regions).toHaveLength(3);
    expect((regions[0] as Ds9Region & { r: number }).r).toBeCloseTo(3 / 60, 9); // arcmin → deg
    expect((regions[1] as Ds9Region & { r: number }).r).toBeCloseTo(0.5, 9); // bare = deg
    const ell = regions[2]!;
    if (ell.shape !== 'ellipse') throw new Error('type');
    expect(ell.a).toBeCloseTo(1, 9);
    expect(ell.b).toBeCloseTo(2, 9);
    expect(ell.angle).toBeCloseTo(45, 9);
  });

  it('parses sexagesimal: RA in hours (odd arg ×15), Dec in degrees', () => {
    // fk5 circle at RA 10:00:00 (=150°), Dec -20:30:00 (=-20.5°), radius 1'.
    const regions = parseDs9("fk5\ncircle(10:00:00,-20:30:00,1')");
    expect(regions).toHaveLength(1);
    const c = regions[0]!;
    if (c.shape !== 'circle') throw new Error('type');
    expect(c.x).toBeCloseTo(150, 6); // 10h → 150°
    expect(c.y).toBeCloseTo(-20.5, 6); // -20:30:00
    expect(c.r).toBeCloseTo(1 / 60, 9);
  });

  it('handles the space-separated form and box shape', () => {
    const regions = parseDs9('image\nbox 200 300 50 40 0\ncircle 100 100 20');
    expect(regions).toHaveLength(2);
    const box = regions[0]!;
    if (box.shape !== 'box') throw new Error('type');
    expect(box.frame).toBe('image');
    expect(box).toMatchObject({ x: 200, y: 300, w: 50, h: 40, angle: 0 });
    // image pixels are NOT divided by 3600.
    expect((regions[1] as Ds9Region & { r: number }).r).toBe(20);
  });

  it('skips unknown shapes (point/line/annulus/text) without throwing', () => {
    const regions = parseDs9(
      'fk5\npoint(1,2) # point=circle\nline(1,2,3,4)\nannulus(1,2,3,4)\ntext(1,2) # text={hi}\ncircle(1,2,3)'
    );
    // Only the circle survives; the rest are skipped, not thrown on.
    expect(regions).toHaveLength(1);
    expect(regions[0]!.shape).toBe('circle');
  });

  it('skips malformed shape lines without throwing or fabricating regions', () => {
    expect(() => parseDs9('fk5\ncircle(1,2)\ncircle(a,b,c)\npolygon(1,2,3)')).not.toThrow();
    const regions = parseDs9('fk5\ncircle(1,2)\ncircle(a,b,c)\npolygon(1,2,3)\ncircle(1,2,3)');
    // circle missing radius → skip; non-numeric → skip; odd polygon → skip.
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ shape: 'circle', x: 1, y: 2, r: 3 });
  });

  it('converts a radians length suffix and letter-form h/d/m/s coordinates', () => {
    const regions = parseDs9('fk5\ncircle(10h00m00s,-20d30m00s,0.01r)');
    expect(regions).toHaveLength(1);
    const c = regions[0]!;
    if (c.shape !== 'circle') throw new Error('type');
    expect(c.x).toBeCloseTo(150, 6); // 10h → 150°
    expect(c.y).toBeCloseTo(-20.5, 6); // -20d30m → -20.5°
    expect(c.r).toBeCloseTo(0.01 * (180 / Math.PI), 9); // radians → deg
  });

  it('honours an inline `fk5; circle(...)` coordinate-system segment', () => {
    const regions = parseDs9('fk5; circle(150,-20.5,0.02) # color=green');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ shape: 'circle', frame: 'icrs', x: 150, y: -20.5 });
  });

  it('returns [] for junk / empty input rather than throwing', () => {
    expect(parseDs9('')).toEqual([]);
    expect(parseDs9('this is not a region file at all')).toEqual([]);
    // @ts-expect-error – defensive: non-string input must not throw.
    expect(parseDs9(null)).toEqual([]);
  });
});

describe('serializeDs9 / round-trip', () => {
  it('serialize → parse round-trips numerically', () => {
    const regions = parseDs9(SAMPLE);
    const round = parseDs9(serializeDs9(regions));
    expect(round).toHaveLength(regions.length);
    const c0 = regions[0] as Ds9Region & { x: number; y: number; r: number };
    const c1 = round[0] as Ds9Region & { x: number; y: number; r: number };
    expect(c1.shape).toBe('circle');
    expect(c1.x).toBeCloseTo(c0.x, 6);
    expect(c1.y).toBeCloseTo(c0.y, 6);
    expect(c1.r).toBeCloseTo(c0.r, 6); // still degrees (arcsec-converted), not re-multiplied
    const p1 = round[1]!;
    if (p1.shape !== 'polygon') throw new Error('type');
    expect(p1.points).toHaveLength(3);
  });

  it('is byte-idempotent: serialize(parse(serialize(x))) === serialize(x)', () => {
    const regions = parseDs9(SAMPLE);
    const once = serializeDs9(regions);
    const twice = serializeDs9(parseDs9(once));
    expect(twice).toBe(once);
  });

  it('emits the DS9 header + coordsys line and paren shape form', () => {
    const text = serializeDs9([
      { shape: 'circle', frame: 'icrs', x: 150, y: -20.5, r: 0.01 },
    ]);
    expect(text).toContain('# Region file format: DS9');
    expect(text).toContain('\nicrs\n');
    expect(text).toMatch(/circle\(150,-20\.5,0\.01\)/);
  });

  it('serializes ellipse and box shapes and round-trips them', () => {
    const input: Ds9Region[] = [
      { shape: 'ellipse', frame: 'icrs', x: 150, y: -20.5, a: 0.02, b: 0.01, angle: 30 },
      { shape: 'box', frame: 'icrs', x: 150, y: -20.5, w: 0.04, h: 0.02, angle: 45 },
    ];
    const text = serializeDs9(input);
    expect(text).toContain('ellipse(150,-20.5,0.02,0.01,30)');
    expect(text).toContain('box(150,-20.5,0.04,0.02,45)');
    const round = parseDs9(text);
    expect(round).toEqual(input);
  });

  it('inlines the frame per shape when frames are mixed', () => {
    const text = serializeDs9([
      { shape: 'circle', frame: 'icrs', x: 1, y: 2, r: 3 },
      { shape: 'circle', frame: 'image', x: 10, y: 20, r: 5 },
    ]);
    expect(text).toContain('icrs; circle(1,2,3)');
    expect(text).toContain('image; circle(10,20,5)');
    // And it must round-trip the mixed frames.
    const round = parseDs9(text);
    expect(round[0]!.frame).toBe('icrs');
    expect(round[1]!.frame).toBe('image');
  });
});
