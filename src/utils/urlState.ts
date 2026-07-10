/**
 * Shareable-view permalink (de)serialization.
 *
 * Intent: let a user copy the browser URL and reopen the EXACT same view —
 * position (ra/dec), zoom, base layer, Rubin dataset/band, stretch, colormap,
 * and active survey overlays. The state lives in the URL hash so it is short,
 * human-legible, and never round-trips through the server, e.g.:
 *
 *   #ra=150.12&dec=2.2&z=8&base=rubin&ds=color_gri&scale=asinh&cmap=viridis&inv=1&ov=gaia,dss2
 *
 * Design contract:
 *  - `encodeState`/`decodeState` are PURE (no DOM). They are what the tests
 *    exercise. `applyStateToUrl`/`readStateFromUrl` are the ONLY impure fns —
 *    tiny wrappers over `window.location`/`history`, guarded for non-browser.
 *  - `decodeState` NEVER throws on garbage. A value that cannot be trusted is
 *    OMITTED from the returned Partial — it is never coerced to a default. In
 *    particular a non-numeric / empty ra or dec is dropped, NOT read as 0: a
 *    silent (0,0) would teleport the user to the celestial origin. Numeric but
 *    out-of-range coordinates are repaired (ra wrapped into [0,360), dec clamped
 *    to [-90,90]) rather than dropped, since the intent is unambiguous.
 *  - Enum-valued keys (base/scale/cmap/band) are validated against their allowed
 *    sets; an out-of-set value is dropped.
 *  - ra/dec are rounded to 6 decimals so the URL is stable, not 15 digits.
 */

import {
  isScalingFunction,
  isColorMapName,
  type ScalingFunction,
  type ColorMapName,
} from '../types/image.js';

/** Base layer identifiers matching `TileViewer`'s `baseLayerId`. */
export type PermalinkBase = 'auto' | 'dss' | 'rubin' | 'offline';

/** Offline synthetic-cube band selector (ugrizy). */
export type PermalinkBand = 'u' | 'g' | 'r' | 'i' | 'z' | 'y';

/** The full shareable view state. Optional fields are omitted from the hash
 *  (and from a decoded Partial) when absent. */
export interface ViewPermalink {
  /** Right ascension in degrees, wrapped into [0, 360). */
  ra: number;
  /** Declination in degrees, clamped to [-90, 90]. */
  dec: number;
  /** Integer zoom level. */
  zoom: number;
  /** Active base layer. */
  base: PermalinkBase;
  /** Rubin HiPS dataset id, e.g. `color_gri` or `band_r`. */
  rubinDataset: string;
  /** DS9-style stretch / scaling function. */
  scaling: ScalingFunction;
  /** Colormap name. */
  colorMap: ColorMapName;
  /** Invert the colormap. */
  invert?: boolean;
  /** Active survey overlay ids (e.g. `gaia`, `dss2`). */
  overlays?: string[];
  /** Offline cube band (only meaningful when base === 'offline'). */
  offlineBand?: PermalinkBand;
  /** Offline cube epoch index (integer). */
  offlineEpoch?: number;
}

/** Hash key names — kept short and legible. This is the wire format. */
const KEY = {
  ra: 'ra',
  dec: 'dec',
  zoom: 'z',
  base: 'base',
  rubinDataset: 'ds',
  scaling: 'scale',
  colorMap: 'cmap',
  invert: 'inv',
  overlays: 'ov',
  offlineBand: 'band',
  offlineEpoch: 'epoch',
} as const;

const BASE_VALUES: readonly PermalinkBase[] = ['auto', 'dss', 'rubin', 'offline'];
const BAND_VALUES: readonly PermalinkBand[] = ['u', 'g', 'r', 'i', 'z', 'y'];

const COORD_DECIMALS = 6;

/** Round to a stable number of decimals, dropping trailing zeros. */
function round6(n: number): number {
  return Number(n.toFixed(COORD_DECIMALS));
}

/** Wrap an angle into [0, 360). */
function wrapRa(ra: number): number {
  const w = ((ra % 360) + 360) % 360;
  // round6(359.9999996) === 360 → re-wrap so the result never equals 360.
  return w === 360 ? 0 : w;
}

/** Clamp declination to [-90, 90]. */
function clampDec(dec: number): number {
  return Math.max(-90, Math.min(90, dec));
}

/**
 * Parse a string that MUST represent a finite number. Returns null for empty /
 * whitespace / non-numeric input. Critically, `Number('')` is 0 in JS — this
 * guard rejects the empty string so `dec=` is dropped, not read as 0.
 */
function parseFiniteNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Safe URI-component decode: never throws on a malformed `%` sequence. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Serialize a full view state to a hash body WITHOUT the leading `#`.
 * Optional fields are emitted only when present (invert/overlays are emitted
 * whenever defined, including `false` and `[]`, so they round-trip exactly).
 */
export function encodeState(s: ViewPermalink): string {
  const parts: string[] = [];
  parts.push(`${KEY.ra}=${round6(wrapRa(s.ra))}`);
  parts.push(`${KEY.dec}=${round6(clampDec(s.dec))}`);
  parts.push(`${KEY.zoom}=${Math.round(s.zoom)}`);
  parts.push(`${KEY.base}=${s.base}`);
  parts.push(`${KEY.rubinDataset}=${encodeURIComponent(s.rubinDataset)}`);
  parts.push(`${KEY.scaling}=${s.scaling}`);
  parts.push(`${KEY.colorMap}=${s.colorMap}`);
  if (s.invert !== undefined) parts.push(`${KEY.invert}=${s.invert ? '1' : '0'}`);
  if (s.overlays !== undefined) {
    parts.push(`${KEY.overlays}=${s.overlays.map(encodeURIComponent).join(',')}`);
  }
  if (s.offlineBand !== undefined) parts.push(`${KEY.offlineBand}=${s.offlineBand}`);
  if (s.offlineEpoch !== undefined) parts.push(`${KEY.offlineEpoch}=${Math.round(s.offlineEpoch)}`);
  return parts.join('&');
}

/**
 * Parse a hash body into a validated Partial view state. Accepts input with or
 * without a leading `#` or `?`. Unknown keys are ignored; missing keys are
 * tolerated; invalid values are DROPPED (never defaulted). Never throws.
 */
export function decodeState(hash: string): Partial<ViewPermalink> {
  const out: Partial<ViewPermalink> = {};
  if (typeof hash !== 'string') return out;

  // Strip a single leading '#' or '?'.
  let body = hash;
  if (body.startsWith('#') || body.startsWith('?')) body = body.slice(1);
  if (body === '') return out;

  const raw = new Map<string, string>();
  for (const pair of body.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? '' : safeDecode(pair.slice(eq + 1));
    if (k !== '') raw.set(k, v);
  }

  // ra: numeric-only, out-of-range wrapped (never coerced to 0).
  if (raw.has(KEY.ra)) {
    const n = parseFiniteNumber(raw.get(KEY.ra)!);
    if (n !== null) out.ra = round6(wrapRa(n));
  }
  // dec: numeric-only, out-of-range clamped.
  if (raw.has(KEY.dec)) {
    const n = parseFiniteNumber(raw.get(KEY.dec)!);
    if (n !== null) out.dec = round6(clampDec(n));
  }
  // zoom: integer.
  if (raw.has(KEY.zoom)) {
    const n = parseFiniteNumber(raw.get(KEY.zoom)!);
    if (n !== null) out.zoom = Math.round(n);
  }
  // base: enum.
  if (raw.has(KEY.base)) {
    const v = raw.get(KEY.base)!;
    if ((BASE_VALUES as readonly string[]).includes(v)) out.base = v as PermalinkBase;
  }
  // rubinDataset: free non-empty string.
  if (raw.has(KEY.rubinDataset)) {
    const v = raw.get(KEY.rubinDataset)!;
    if (v !== '') out.rubinDataset = v;
  }
  // scaling: enum (validated by type guard).
  if (raw.has(KEY.scaling)) {
    const v = raw.get(KEY.scaling)!;
    if (isScalingFunction(v)) out.scaling = v;
  }
  // colorMap: enum (validated by type guard).
  if (raw.has(KEY.colorMap)) {
    const v = raw.get(KEY.colorMap)!;
    if (isColorMapName(v)) out.colorMap = v;
  }
  // invert: strict boolean flag.
  if (raw.has(KEY.invert)) {
    const v = raw.get(KEY.invert)!;
    if (v === '1') out.invert = true;
    else if (v === '0') out.invert = false;
  }
  // overlays: comma-joined ids; empty string means an explicit empty list.
  if (raw.has(KEY.overlays)) {
    out.overlays = raw.get(KEY.overlays)!.split(',').filter((x) => x.length > 0);
  }
  // offlineBand: enum (ugrizy).
  if (raw.has(KEY.offlineBand)) {
    const v = raw.get(KEY.offlineBand)!;
    if ((BAND_VALUES as readonly string[]).includes(v)) out.offlineBand = v as PermalinkBand;
  }
  // offlineEpoch: integer index.
  if (raw.has(KEY.offlineEpoch)) {
    const n = parseFiniteNumber(raw.get(KEY.offlineEpoch)!);
    if (n !== null) out.offlineEpoch = Math.round(n);
  }

  return out;
}

/**
 * Impure: write the current state to the URL hash via `history.replaceState`
 * (so it does not add a back-button entry). No-op outside a browser.
 */
export function applyStateToUrl(s: ViewPermalink): void {
  if (typeof window === 'undefined' || !window.history) return;
  window.history.replaceState(null, '', `#${encodeState(s)}`);
}

/**
 * Impure: read and decode the current URL hash. Returns `{}` outside a browser.
 */
export function readStateFromUrl(): Partial<ViewPermalink> {
  if (typeof window === 'undefined' || !window.location) return {};
  return decodeState(window.location.hash);
}
