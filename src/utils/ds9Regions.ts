/**
 * DS9 / SAOImage region-file parser + serializer (feature 121).
 *
 * PURE — no DOM. Sky regions are stored internally in ICRS DEGREES (RA, Dec) with
 * all radii / semi-axes / box sides in DEGREES; arcsec (") and arcmin (') inputs
 * are converted to degrees at the parse boundary. Angles are in degrees.
 *
 * ── Format confirmed against the authoritative SAOImageDS9 "Regions" reference
 *    (https://ds9.si.edu/doc/ref/region.html), verified 2026-07 ──
 *
 * • Header line (optional):  `# Region file format: DS9 version 4.0`
 * • Coordinate-system line (its own line, or inline before a shape via `;`):
 *     equatorial: fk5 · fk4 · icrs · j2000 · b1950 · wcs   → modelled as 'icrs'
 *     pixel:      image · physical · detector · linear      → modelled as 'image'
 *   The system applies to every following shape until changed. Default is image,
 *   but this viewer is equatorial so an undeclared system is treated as icrs.
 * • Shapes accept EITHER paren+comma `circle(x,y,r)` OR space form `circle x y r`
 *   ("arguments may be separated with either a comma or space; optional
 *   parentheses may be used"). Grammar supported here:
 *     circle  x y r
 *     ellipse x y a b angle        (a, b = semi-axes)
 *     box     x y w h angle        (w, h = full width/height)
 *     polygon x1 y1 x2 y2 ...      (≥ 3 vertices)
 *   Any other shape (point, line, annulus, vector, text, …) is SKIPPED, never
 *   thrown on. A malformed shape line is skipped too.
 * • Trailing ` # color=… text={…}` attributes after a shape are ignored.
 * • Units — for a sky system a PLAIN number is degrees for BOTH RA and Dec;
 *   sexagesimal `h:m:s` is HOURS for the RA (odd) argument and `d:m:s` DEGREES
 *   for the Dec (even) argument. Length suffixes: `"`=arcsec, `'`=arcmin,
 *   `d`=degrees, `r`=radians, bare=degrees (sky) / pixels (image).
 */

const RAD2DEG = 180 / Math.PI;

/** Coordinate frame a region's numbers live in. Sky (icrs) numbers are DEGREES;
 *  image numbers are PIXELS (no WCS available here to convert them to sky). */
export type Ds9Frame = 'icrs' | 'image';

export interface Ds9Circle {
  shape: 'circle';
  frame: Ds9Frame;
  /** RA (deg) for icrs, x-pixel for image. */
  x: number;
  /** Dec (deg) for icrs, y-pixel for image. */
  y: number;
  /** Radius: degrees (icrs) or pixels (image). */
  r: number;
}

export interface Ds9Ellipse {
  shape: 'ellipse';
  frame: Ds9Frame;
  x: number;
  y: number;
  /** Semi-major axis (deg / px). */
  a: number;
  /** Semi-minor axis (deg / px). */
  b: number;
  /** Rotation angle, degrees CCW. */
  angle: number;
}

export interface Ds9Box {
  shape: 'box';
  frame: Ds9Frame;
  x: number;
  y: number;
  /** Full width (deg / px). */
  w: number;
  /** Full height (deg / px). */
  h: number;
  angle: number;
}

export interface Ds9Polygon {
  shape: 'polygon';
  frame: Ds9Frame;
  /** Vertices, in the frame's units (deg for icrs, px for image). */
  points: { x: number; y: number }[];
}

export type Ds9Region = Ds9Circle | Ds9Ellipse | Ds9Box | Ds9Polygon;

// Sky (→ icrs degrees) vs pixel (→ image) coordinate-system tokens. Non-equatorial
// sky systems (galactic/ecliptic) are lumped into 'icrs' best-effort — this viewer
// only draws equatorial, so their numeric values are read as-is (documented).
const SKY_FRAMES = new Set([
  'fk5', 'fk4', 'icrs', 'j2000', 'b1950', 'equatorial', 'wcs', 'wcsa', 'galactic', 'ecliptic',
]);
const IMAGE_FRAMES = new Set(['image', 'physical', 'detector', 'amplifier', 'linear']);

/** Map a coordinate-system token to our frame model, or null if not a system. */
function normalizeFrame(token: string): Ds9Frame | null {
  const t = token.toLowerCase();
  if (SKY_FRAMES.has(t)) return 'icrs';
  if (IMAGE_FRAMES.has(t)) return 'image';
  return null;
}

/**
 * Parse one coordinate token → degrees (sky) or pixels (image).
 * @param isRa true for an RA / x argument (sexagesimal → hours ×15).
 */
function parseCoordinate(token: string, isRa: boolean, frame: Ds9Frame): number {
  const t = token.trim();
  if (t === '') return NaN;
  if (frame === 'image') return Number(t);

  // Sexagesimal colon form: h:m:s (RA) or d:m:s (Dec).
  if (t.includes(':')) {
    const neg = t.startsWith('-');
    const parts = t.replace(/^[+-]/, '').split(':');
    if (parts.length < 1 || parts.length > 3) return NaN;
    let val = 0;
    let scale = 1;
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isFinite(n)) return NaN;
      val += n / scale;
      scale *= 60;
    }
    if (isRa) val *= 15; // hours → degrees
    return neg ? -val : val;
  }

  // Explicit letter form: 10h20m30s, 47d12m30s, -30d, 12h.
  if (/[hdms]/i.test(t) && !/^[+-]?[\d.]+d$/i.test(t)) {
    const m = t.match(
      /^([+-]?)(?:([\d.]+)h)?(?:([\d.]+)d)?(?:([\d.]+)m)?(?:([\d.]+)s)?$/i
    );
    if (m) {
      const sign = m[1] === '-' ? -1 : 1;
      const h = m[2] ? Number(m[2]) : 0;
      const d = m[3] ? Number(m[3]) : 0;
      const min = m[4] ? Number(m[4]) : 0;
      const s = m[5] ? Number(m[5]) : 0;
      if (m[2] !== undefined) return sign * (h + min / 60 + s / 3600) * 15; // hms → deg
      return sign * (d + min / 60 + s / 3600);
    }
    return NaN;
  }

  // Plain decimal (possibly trailing 'd') — degrees for both RA and Dec.
  return Number(t.replace(/d$/i, ''));
}

/** Parse a length token (radius / semi-axis / side) → degrees (sky) or pixels. */
function parseLength(token: string, frame: Ds9Frame): number {
  const t = token.trim();
  if (t === '') return NaN;
  const num = parseFloat(t);
  if (!Number.isFinite(num)) return NaN;
  if (frame === 'image') return num; // pixels
  const last = t[t.length - 1];
  switch (last) {
    case '"':
      return num / 3600; // arcsec → deg
    case "'":
      return num / 60; // arcmin → deg
    case 'r':
      return num * RAD2DEG; // radians → deg
    case 'd':
      return num; // degrees
    default:
      return num; // bare number in a sky system is degrees
  }
}

/** Parse a rotation angle token → degrees. */
function parseAngle(token: string): number {
  return Number(token.trim().replace(/d$/i, ''));
}

/** Extract a shape's argument list from `body` (paren+comma OR space/comma form). */
function extractArgs(body: string): string[] {
  const paren = body.match(/\(([^)]*)\)/);
  const raw = paren ? paren[1]! : body;
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse one shape segment (system already resolved) → a region, or null to skip. */
function parseShape(segment: string, frame: Ds9Frame): Ds9Region | null {
  // Strip a leading include/exclude flag (`+`/`-`/`!`); we keep the geometry.
  const seg = segment.replace(/^[!+-]\s*/, '').trim();
  const m = seg.match(/^([a-zA-Z]+)\b(.*)$/s);
  if (!m) return null;
  const name = m[1]!.toLowerCase();
  const args = extractArgs(m[2]!);

  switch (name) {
    case 'circle': {
      if (args.length < 3) return null;
      const x = parseCoordinate(args[0]!, true, frame);
      const y = parseCoordinate(args[1]!, false, frame);
      const r = parseLength(args[2]!, frame);
      if (![x, y, r].every(Number.isFinite)) return null;
      return { shape: 'circle', frame, x, y, r };
    }
    case 'ellipse': {
      if (args.length < 5) return null;
      const x = parseCoordinate(args[0]!, true, frame);
      const y = parseCoordinate(args[1]!, false, frame);
      const a = parseLength(args[2]!, frame);
      const b = parseLength(args[3]!, frame);
      const angle = parseAngle(args[4]!);
      if (![x, y, a, b, angle].every(Number.isFinite)) return null;
      return { shape: 'ellipse', frame, x, y, a, b, angle };
    }
    case 'box': {
      if (args.length < 5) return null;
      const x = parseCoordinate(args[0]!, true, frame);
      const y = parseCoordinate(args[1]!, false, frame);
      const w = parseLength(args[2]!, frame);
      const h = parseLength(args[3]!, frame);
      const angle = parseAngle(args[4]!);
      if (![x, y, w, h, angle].every(Number.isFinite)) return null;
      return { shape: 'box', frame, x, y, w, h, angle };
    }
    case 'polygon': {
      // Need an even count of ≥ 6 numbers (≥ 3 vertices).
      if (args.length < 6 || args.length % 2 !== 0) return null;
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < args.length; i += 2) {
        const x = parseCoordinate(args[i]!, true, frame);
        const y = parseCoordinate(args[i + 1]!, false, frame);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        points.push({ x, y });
      }
      return { shape: 'polygon', frame, points };
    }
    default:
      return null; // unknown shape → skip
  }
}

/**
 * Parse DS9 region-file text into typed regions (sky in ICRS degrees).
 * Tolerant: header / comment / blank / `global` lines and unknown shapes are
 * skipped; a malformed shape line is skipped rather than throwing. Never throws.
 */
export function parseDs9(text: string): Ds9Region[] {
  const regions: Ds9Region[] = [];
  if (typeof text !== 'string') return regions;
  let frame: Ds9Frame = 'icrs'; // viewer default; overridden by any system line

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (line.startsWith('#')) continue; // header / comment
    if (/^global\b/i.test(line)) continue; // global attribute defaults

    // A line may hold several `;`-separated segments (e.g. "fk5; circle(...)").
    for (let segment of line.split(';')) {
      // Drop trailing region attributes introduced by `#`.
      const hashIdx = segment.indexOf('#');
      if (hashIdx >= 0) segment = segment.slice(0, hashIdx);
      segment = segment.trim();
      if (segment === '') continue;

      // A lone coordinate-system token sets the frame for what follows.
      const tokens = segment.split(/\s+/);
      if (tokens.length === 1) {
        const f = normalizeFrame(tokens[0]!);
        if (f) {
          frame = f;
          continue;
        }
      }

      const region = parseShape(segment, frame);
      if (region) regions.push(region);
    }
  }

  return regions;
}

/** Format a number with fixed precision but no trailing-zero noise beyond 6 dp.
 *  6 dp of a degree ≈ 3.6 mas — finer than any drawn/imported region — and makes
 *  serialize→parse→serialize byte-stable (idempotent). */
function fmt(n: number): string {
  return Number(n.toFixed(6)).toString();
}

/**
 * Serialize regions back to DS9 region-file text. Emits the standard header, a
 * single coordinate-system line when every region shares a frame (the common
 * case — all drawn regions are icrs), else an inline `frame;` per shape. Sky
 * numbers are written in DEGREES (bare = degrees in a sky system), so a
 * serialize→parse round-trip is numerically stable.
 */
export function serializeDs9(regions: Ds9Region[]): string {
  const lines = ['# Region file format: DS9 version 4.0'];

  const frameToken = (f: Ds9Frame): string => (f === 'image' ? 'image' : 'icrs');
  const shapeBody = (r: Ds9Region): string => {
    switch (r.shape) {
      case 'circle':
        return `circle(${fmt(r.x)},${fmt(r.y)},${fmt(r.r)})`;
      case 'ellipse':
        return `ellipse(${fmt(r.x)},${fmt(r.y)},${fmt(r.a)},${fmt(r.b)},${fmt(r.angle)})`;
      case 'box':
        return `box(${fmt(r.x)},${fmt(r.y)},${fmt(r.w)},${fmt(r.h)},${fmt(r.angle)})`;
      case 'polygon':
        return `polygon(${r.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(',')})`;
    }
  };

  const allSameFrame =
    regions.length > 0 && regions.every((r) => r.frame === regions[0]!.frame);

  if (allSameFrame) {
    lines.push(frameToken(regions[0]!.frame));
    for (const r of regions) lines.push(shapeBody(r));
  } else {
    for (const r of regions) lines.push(`${frameToken(r.frame)}; ${shapeBody(r)}`);
  }

  return lines.join('\n') + '\n';
}
