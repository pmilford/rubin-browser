/**
 * Minimal, dependency-free FITS image reader (primary HDU only).
 *
 * FITS is the Flexible Image Transport System — the standard astronomical image
 * container. This parser exists so the Rubin Browser can read *linear float*
 * pixels (real photometry) instead of pre-stretched 8-bit JPEG tiles, enabling
 * honest stretch, un-saturated stellar cores, and calibrated value readouts.
 *
 * CLAUDE.md forbids a runtime FITS dependency (no FITS.js), so this is our own
 * small parser in plain TypeScript. It is PURE — no DOM, no fetch — so it is
 * unit-testable against synthetic ground-truth buffers.
 *
 * Scope: the primary HDU of an image FITS file, standard BITPIX values
 * (8, 16, 32, -32, -64), BIG-ENDIAN as the FITS standard mandates, with
 * BSCALE/BZERO applied and BLANK/NaN flagged as NaN. WCS keywords are passed
 * through untouched; full WCS (TAN projection, CD matrix inversion) is a
 * deliberate follow-up — see the note at the bottom of this file.
 *
 * References: FITS Standard 4.0 (IAU FITS Working Group).
 */

/** A FITS header block is exactly 2880 bytes (36 cards of 80 chars). */
const FITS_BLOCK_BYTES = 2880;

/** Each header card ("KEYWORD = value / comment") is exactly 80 chars. */
const FITS_CARD_CHARS = 80;

/** Number of cards per 2880-byte block. */
const CARDS_PER_BLOCK = FITS_BLOCK_BYTES / FITS_CARD_CHARS; // 36

/** Keyword occupies columns 1-8; the value indicator "= " sits at columns 9-10. */
const KEYWORD_CHARS = 8;

/**
 * Parsed primary-HDU header. Required keywords are always present; optional
 * astrometry / provenance keywords are passed through when found. The raw
 * `cards` map keeps every parsed keyword so callers can reach anything we did
 * not promote to a named field.
 */
export interface FitsHeader {
  /** SIMPLE — must be true for a conforming primary HDU. */
  simple: boolean;
  /** BITPIX — pixel data type code: 8, 16, 32, -32, -64. */
  bitpix: number;
  /** NAXIS — number of axes (image HDUs use 2). */
  naxis: number;
  /** NAXIS1 — fastest-varying axis length (image width, columns). */
  naxis1: number;
  /** NAXIS2 — slower-varying axis length (image height, rows). */
  naxis2: number;
  /** BSCALE — physical = BSCALE*raw + BZERO. Defaults to 1. */
  bscale: number;
  /** BZERO — additive offset for the physical value. Defaults to 0. */
  bzero: number;
  /** BLANK — raw integer value meaning "undefined" (integer BITPIX only). */
  blank?: number;
  /** OBJECT — target name, if present. */
  object?: string;
  /** BUNIT — physical unit of the pixel values, if present. */
  bunit?: string;
  /** CRVAL1/2 — world coordinates at the reference pixel (degrees). */
  crval1?: number;
  crval2?: number;
  /** CRPIX1/2 — reference pixel (1-based FITS convention). */
  crpix1?: number;
  crpix2?: number;
  /** CDELT1/2 — pixel scale (degrees/pixel) when no CD matrix is given. */
  cdelt1?: number;
  cdelt2?: number;
  /** CD1_1..CD2_2 — linear WCS transform matrix, if present. */
  cd1_1?: number;
  cd1_2?: number;
  cd2_1?: number;
  cd2_2?: number;
  /** CTYPE1/2 — axis/projection type strings (e.g. 'RA---TAN'). */
  ctype1?: string;
  ctype2?: string;
  /** Every parsed keyword, verbatim, for anything not promoted above. */
  cards: Record<string, string | number | boolean>;
}

/**
 * Result of reading a FITS primary HDU: the parsed header plus physical pixel
 * values in a Float64Array, row-major (first row first), with BLANK/NaN as NaN.
 */
export interface FitsImage {
  header: FitsHeader;
  /** Image width in pixels (== header.naxis1). */
  width: number;
  /** Image height in pixels (== header.naxis2). */
  height: number;
  /** Physical pixel values, length width*height, row-major, NaN for BLANK. */
  data: Float64Array;
}

/** Bytes consumed per pixel for a given BITPIX (absolute value / 8). */
function bytesPerPixel(bitpix: number): number {
  switch (bitpix) {
    case 8:
      return 1;
    case 16:
      return 2;
    case 32:
      return 4;
    case -32:
      return 4;
    case -64:
      return 8;
    default:
      throw new Error(
        `Unsupported BITPIX ${bitpix}: expected one of 8, 16, 32, -32, -64`
      );
  }
}

/**
 * Parse a single 80-char card's value field into a typed JS value.
 * Handles FITS logical (T/F), quoted strings (with '' escaping), and numbers.
 * Returns undefined for value-less cards (comments, HISTORY, blank).
 */
function parseCardValue(card: string): string | number | boolean | undefined {
  // Value cards have "= " in columns 9-10 (0-based indices 8-9).
  if (card[KEYWORD_CHARS] !== '=') return undefined;

  const field = card.slice(KEYWORD_CHARS + 1);

  // String value: begins with a single quote (after optional leading spaces).
  const trimmedStart = field.replace(/^\s+/, '');
  if (trimmedStart.startsWith("'")) {
    // Read until the closing quote; a doubled '' is a literal quote.
    let value = '';
    let i = 1; // skip opening quote
    while (i < trimmedStart.length) {
      const ch = trimmedStart[i];
      if (ch === "'") {
        if (trimmedStart[i + 1] === "'") {
          value += "'";
          i += 2;
          continue;
        }
        break; // closing quote
      }
      value += ch;
      i += 1;
    }
    // FITS pads strings with trailing spaces; strip them.
    return value.replace(/\s+$/, '');
  }

  // Non-string: strip an inline comment (everything from the first '/').
  const slashIndex = field.indexOf('/');
  const raw = (slashIndex >= 0 ? field.slice(0, slashIndex) : field).trim();
  if (raw === '') return undefined;

  if (raw === 'T') return true;
  if (raw === 'F') return false;

  // Numeric: FITS uses 'D'/'E' exponent letters; normalize D→E.
  const num = Number(raw.replace(/[dD]/, 'E'));
  if (Number.isNaN(num)) return raw; // fall back to the literal token
  return num;
}

/**
 * Parse the primary-HDU header from a FITS buffer. Returns the typed header and
 * the byte offset where the data array begins (next 2880-byte boundary after
 * the END card). Throws on a non-FITS buffer.
 */
function parseHeader(buffer: ArrayBuffer): { header: FitsHeader; dataOffset: number } {
  const bytes = new Uint8Array(buffer);
  const cards: Record<string, string | number | boolean> = {};
  let ended = false;
  let cardCount = 0;

  outer: for (let block = 0; block * FITS_BLOCK_BYTES < bytes.length; block++) {
    const blockStart = block * FITS_BLOCK_BYTES;
    for (let c = 0; c < CARDS_PER_BLOCK; c++) {
      const start = blockStart + c * FITS_CARD_CHARS;
      if (start + FITS_CARD_CHARS > bytes.length) break outer;

      // Header is guaranteed ASCII; decode this 80-byte card directly.
      let card = '';
      for (let k = 0; k < FITS_CARD_CHARS; k++) {
        card += String.fromCharCode(bytes[start + k]!);
      }

      const keyword = card.slice(0, KEYWORD_CHARS).trim();

      if (cardCount === 0 && keyword !== 'SIMPLE') {
        throw new Error(
          'Not a valid FITS file: first keyword is not SIMPLE ' +
            `(found "${keyword}")`
        );
      }
      cardCount += 1;

      if (keyword === 'END') {
        ended = true;
        // Data begins at the next 2880-byte boundary after this block.
        return { header: finalizeHeader(cards), dataOffset: (block + 1) * FITS_BLOCK_BYTES };
      }

      if (keyword === '' || keyword === 'COMMENT' || keyword === 'HISTORY') {
        continue;
      }

      const value = parseCardValue(card);
      if (value !== undefined) {
        cards[keyword] = value;
      }
    }
  }

  if (!ended) {
    throw new Error('Not a valid FITS file: header END card not found');
  }
  // Unreachable, but keeps the type checker happy.
  return { header: finalizeHeader(cards), dataOffset: FITS_BLOCK_BYTES };
}

/** Read a required numeric keyword or throw a descriptive error. */
function requireNumber(cards: Record<string, string | number | boolean>, key: string): number {
  const v = cards[key];
  if (typeof v !== 'number') {
    throw new Error(`Not a valid FITS image: missing or non-numeric ${key}`);
  }
  return v;
}

/** Promote raw cards into the typed FitsHeader, applying FITS defaults. */
function finalizeHeader(cards: Record<string, string | number | boolean>): FitsHeader {
  const simple = cards.SIMPLE;
  if (simple !== true) {
    throw new Error('Not a valid FITS file: SIMPLE is not T');
  }

  const bitpix = requireNumber(cards, 'BITPIX');
  const naxis = requireNumber(cards, 'NAXIS');
  if (naxis < 2) {
    throw new Error(`Unsupported FITS: NAXIS=${naxis}, expected a 2D image (NAXIS>=2)`);
  }
  const naxis1 = requireNumber(cards, 'NAXIS1');
  const naxis2 = requireNumber(cards, 'NAXIS2');

  const header: FitsHeader = {
    simple: true,
    bitpix,
    naxis,
    naxis1,
    naxis2,
    bscale: typeof cards.BSCALE === 'number' ? cards.BSCALE : 1,
    bzero: typeof cards.BZERO === 'number' ? cards.BZERO : 0,
    cards,
  };

  if (typeof cards.BLANK === 'number') header.blank = cards.BLANK;
  if (typeof cards.OBJECT === 'string') header.object = cards.OBJECT;
  if (typeof cards.BUNIT === 'string') header.bunit = cards.BUNIT;
  if (typeof cards.CRVAL1 === 'number') header.crval1 = cards.CRVAL1;
  if (typeof cards.CRVAL2 === 'number') header.crval2 = cards.CRVAL2;
  if (typeof cards.CRPIX1 === 'number') header.crpix1 = cards.CRPIX1;
  if (typeof cards.CRPIX2 === 'number') header.crpix2 = cards.CRPIX2;
  if (typeof cards.CDELT1 === 'number') header.cdelt1 = cards.CDELT1;
  if (typeof cards.CDELT2 === 'number') header.cdelt2 = cards.CDELT2;
  if (typeof cards.CD1_1 === 'number') header.cd1_1 = cards.CD1_1;
  if (typeof cards.CD1_2 === 'number') header.cd1_2 = cards.CD1_2;
  if (typeof cards.CD2_1 === 'number') header.cd2_1 = cards.CD2_1;
  if (typeof cards.CD2_2 === 'number') header.cd2_2 = cards.CD2_2;
  if (typeof cards.CTYPE1 === 'string') header.ctype1 = cards.CTYPE1;
  if (typeof cards.CTYPE2 === 'string') header.ctype2 = cards.CTYPE2;

  return header;
}

/**
 * Read a raw pixel at index `i` for the given BITPIX using BIG-ENDIAN byte
 * order (the FITS standard). DataView defaults to big-endian, so we pass no
 * littleEndian flag — a little-endian bug would visibly corrupt the values.
 */
function readRawPixel(view: DataView, byteOffset: number, bitpix: number): number {
  switch (bitpix) {
    case 8:
      return view.getUint8(byteOffset);
    case 16:
      return view.getInt16(byteOffset); // big-endian (littleEndian omitted)
    case 32:
      return view.getInt32(byteOffset);
    case -32:
      return view.getFloat32(byteOffset);
    case -64:
      return view.getFloat64(byteOffset);
    default:
      throw new Error(
        `Unsupported BITPIX ${bitpix}: expected one of 8, 16, 32, -32, -64`
      );
  }
}

/**
 * Read a FITS primary HDU into physical pixel values.
 *
 * Applies physical = BSCALE*raw + BZERO. Integer pixels equal to BLANK, and any
 * float NaN, become NaN. Data is row-major (NAXIS1 fastest), length
 * width*height, in file order (first row in the file is data row 0).
 *
 * @throws on a non-FITS buffer, an unsupported BITPIX, or a truncated data array.
 */
export function readFits(buffer: ArrayBuffer): FitsImage {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error('readFits: argument is not an ArrayBuffer');
  }
  if (buffer.byteLength < FITS_BLOCK_BYTES) {
    throw new Error(
      `Not a valid FITS file: buffer is ${buffer.byteLength} bytes, ` +
        `smaller than one ${FITS_BLOCK_BYTES}-byte header block`
    );
  }

  const { header, dataOffset } = parseHeader(buffer);
  const { bitpix, naxis1, naxis2, bscale, bzero, blank } = header;

  const pixelCount = naxis1 * naxis2;
  const bpp = bytesPerPixel(bitpix);
  const neededBytes = dataOffset + pixelCount * bpp;
  if (buffer.byteLength < neededBytes) {
    throw new Error(
      `Truncated FITS data: need ${neededBytes} bytes for ${naxis1}x${naxis2} ` +
        `at BITPIX ${bitpix}, buffer is only ${buffer.byteLength}`
    );
  }

  const view = new DataView(buffer, dataOffset);
  const data = new Float64Array(pixelCount);
  const isInteger = bitpix > 0;

  for (let i = 0; i < pixelCount; i++) {
    const raw = readRawPixel(view, i * bpp, bitpix);
    if (isInteger) {
      if (blank !== undefined && raw === blank) {
        data[i] = NaN;
        continue;
      }
    } else if (Number.isNaN(raw)) {
      data[i] = NaN;
      continue;
    }
    data[i] = bscale * raw + bzero;
  }

  return { header, width: naxis1, height: naxis2, data };
}

/**
 * Min and max of the data, ignoring NaN. Returns {min: NaN, max: NaN} when the
 * array is empty or entirely NaN (so callers can detect "no finite data").
 */
export function minMax(data: Float64Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  let found = false;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (Number.isNaN(v)) continue;
    found = true;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!found) return { min: NaN, max: NaN };
  return { min, max };
}

/**
 * Percentile-clip range for a sane default stretch, ignoring NaN.
 * `loPct`/`hiPct` are percentiles in [0, 100] (e.g. 0.5 and 99.5). The returned
 * {min, max} are pixel values at those percentiles of the finite data — feed
 * them straight into scaling.ts as the stretch bounds.
 */
export function percentileClip(
  data: Float64Array,
  loPct: number,
  hiPct: number
): { min: number; max: number } {
  // Collect finite values only; percentiles over NaN are meaningless.
  const finite: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (!Number.isNaN(v)) finite.push(v);
  }
  if (finite.length === 0) return { min: NaN, max: NaN };

  finite.sort((a, b) => a - b);
  const n = finite.length;
  const clampPct = (p: number) => Math.max(0, Math.min(100, p));
  const indexAt = (p: number) =>
    Math.max(0, Math.min(n - 1, Math.round((clampPct(p) / 100) * (n - 1))));

  return { min: finite[indexAt(loPct)]!, max: finite[indexAt(hiPct)]! };
}

// --- Follow-up (out of scope here) ---
// Full WCS: this reader passes CRVAL/CRPIX/CDELT/CD/CTYPE through verbatim but
// does not implement the TAN (gnomonic) pixel<->sky transform or CD-matrix
// inversion needed for calibrated coordinate readout on a FITS cutout. Wire that
// alongside src/utils/projection.ts when FITS cutouts land in ImageViewer.
