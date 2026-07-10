/**
 * Gaia DR3 catalog client — driven by the PUBLIC ESA Gaia TAP service.
 *
 * Unlike the Rubin DP1 clients in this directory (`tap.ts`, `diaSource.ts`,
 * `soda.ts`), Gaia is an OPEN, un-authenticated service: the ESA Gaia Archive
 * TAP endpoint takes anonymous queries and does NOT use the Rubin RSP token.
 * Therefore this module deliberately does NOT import or call `getAuthHeader()` /
 * `isAuthenticated()` from `./auth.js` — attaching a Rubin bearer token to an ESA
 * request would be wrong and pointless. (This is the one client in `src/api/`
 * that is auth-free by design.)
 *
 * Endpoint + protocol (IVOA TAP sync):
 *   POST https://gea.esac.esa.int/tap-server/tap/sync
 *   form params: REQUEST=doQuery, LANG=ADQL, FORMAT=json, QUERY=<adql>
 *   response JSON shape: { metadata: [{ name, datatype, ... }], data: [[...], ...] }
 *   (columns are addressed BY metadata name — never by positional index — because
 *   the archive does not guarantee column order matches the SELECT list.)
 *
 * Scope / honesty (mirrors BACKLOG #12 — do NOT overpromise):
 *   - Main table is `gaiadr3.gaia_source`. Gaia has THREE broad bands, not
 *     per-filter images: G (`phot_g_mean_mag`), G_BP (`phot_bp_mean_mag`), G_RP
 *     (`phot_rp_mean_mag`); `bp_rp` is the published BP−RP colour.
 *   - REDSHIFT: Gaia is a Milky-Way STAR survey; ordinary stars have NO
 *     cosmological redshift. Redshift exists only for the extragalactic subset,
 *     in SEPARATE tables (`gaiadr3.qso_candidates.redshift_qsoc`,
 *     `gaiadr3.galaxy_candidates`). {@link buildGaiaConeAdql} (stars) therefore
 *     NEVER selects a redshift column; {@link buildGaiaQsoAdql} is the distinct,
 *     clearly-named builder that does.
 *
 * The parser fills a columnar {@link GaiaCatalog} of parallel TypedArrays (the
 * same flavour of layout `src/data/alerts.ts` uses) so an overlay renderer can
 * reuse the alert-overlay spatial index over `ra`/`dec`.
 *
 * All coordinates are DEGREES throughout (ICRS); there are no arcsec inputs to
 * convert here.
 */

/** The public ESA Gaia Archive TAP synchronous endpoint (no auth). */
export const GAIA_TAP_SYNC_URL = 'https://gea.esac.esa.int/tap-server/tap/sync';

/** Default row cap for a Gaia cone query (TOP N in the ADQL). */
export const GAIA_DEFAULT_MAX_ROWS = 5000;

export interface GaiaConeParams {
  /** Right ascension of the cone centre, degrees (ICRS). */
  ra: number;
  /** Declination of the cone centre, degrees (ICRS). */
  dec: number;
  /** Cone-search radius in DEGREES (Gaia overlays query fields, not arcsec discs). */
  radiusDeg: number;
  /** Row cap for the query. Default {@link GAIA_DEFAULT_MAX_ROWS}. */
  maxRows?: number;
  /** Optional bright-end/faint cut: keep only sources with phot_g_mean_mag < magLimit. */
  magLimit?: number;
}

/**
 * Columnar Gaia catalog. Parallel arrays indexed 0..count-1 (the layout an
 * overlay renderer + spatial index consume). Floats are Float32Array with NaN for
 * nulls; `sourceId` is a `string[]` on PURPOSE — a Gaia `source_id` is a 64-bit
 * integer that does NOT fit exactly in a JS number (Float64), so keeping it as a
 * decimal string avoids silent precision loss.
 */
export interface GaiaCatalog {
  count: number;
  sourceId: string[];
  ra: Float32Array; // degrees, [0,360)
  dec: Float32Array; // degrees, [-90,90]
  gMag: Float32Array; // phot_g_mean_mag
  bpRp: Float32Array; // bp_rp colour (may be NaN)
  pmRa: Float32Array; // pmra, mas/yr (may be NaN)
  pmDec: Float32Array; // pmdec, mas/yr (may be NaN)
  parallax: Float32Array; // mas (may be NaN)
  radialVelocity: Float32Array; // km/s, often NaN (only the RVS subset has it)
  teff: Float32Array; // teff_gspphot, K, often NaN (only the astrophysical-params subset)
}

/* -------------------------------------------------------------------------- */
/* ADQL construction                                                          */
/* -------------------------------------------------------------------------- */

/** Guard a coordinate/number: reject NaN/Infinity so nothing unsafe is interpolated. */
function finiteNumber(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected a finite number, got ${String(value)}`);
  }
  return value;
}

/**
 * Format a number for ADQL without scientific notation (some ADQL parsers reject
 * `1e-7`). Normal magnitudes stringify cleanly; only extreme values are expanded.
 */
function formatNum(value: number): string {
  const s = String(value);
  if (!/e/i.test(s)) return s;
  return value.toFixed(12);
}

/** Validate and normalise the shared cone parameters into ADQL-safe strings. */
function coneParts(params: GaiaConeParams): {
  raStr: string;
  decStr: string;
  radiusStr: string;
  top: number;
} {
  const raDeg = finiteNumber(params.ra, 'ra');
  const decDeg = finiteNumber(params.dec, 'dec');
  const radius = finiteNumber(params.radiusDeg, 'radiusDeg');
  if (radius <= 0) {
    throw new Error(`Invalid radiusDeg: must be > 0, got ${radius}`);
  }
  const top = Math.max(1, Math.floor(finiteNumber(params.maxRows ?? GAIA_DEFAULT_MAX_ROWS, 'maxRows')));
  return {
    raStr: formatNum(raDeg),
    decStr: formatNum(decDeg),
    radiusStr: formatNum(radius),
    top,
  };
}

/**
 * Build a cone-search ADQL query for Gaia DR3 STARS around a sky position.
 *
 * Selects the standard astrometry + three-band photometry the overlay needs:
 * `source_id, ra, dec, parallax, pmra, pmdec, phot_g_mean_mag, bp_rp,
 * radial_velocity, teff_gspphot` from `gaiadr3.gaia_source`. Radius is DEGREES
 * (TAP CIRCLE wants degrees) and ra/dec/radius are finite-checked, so nothing
 * user-controlled is interpolated as an un-vetted string.
 *
 * This table is stars — it has NO redshift column and this builder never emits
 * one. For extragalactic redshifts use {@link buildGaiaQsoAdql}.
 */
export function buildGaiaConeAdql(params: GaiaConeParams): string {
  const { raStr, decStr, radiusStr, top } = coneParts(params);

  let magClause = '';
  if (params.magLimit !== undefined) {
    magClause = `\n  AND phot_g_mean_mag < ${formatNum(finiteNumber(params.magLimit, 'magLimit'))}`;
  }

  return `SELECT TOP ${top}
  source_id, ra, dec,
  parallax, pmra, pmdec,
  phot_g_mean_mag, bp_rp,
  radial_velocity, teff_gspphot
FROM gaiadr3.gaia_source
WHERE CONTAINS(
  POINT('ICRS', ra, dec),
  CIRCLE('ICRS', ${raStr}, ${decStr}, ${radiusStr})
) = 1${magClause}`;
}

/**
 * Build a cone-search ADQL query for the Gaia DR3 EXTRAGALACTIC QSO-candidate
 * subset (`gaiadr3.qso_candidates`), the ONLY place a Gaia-published redshift
 * (`redshift_qsoc`, estimated from BP/RP) lives. Kept as a distinct, explicitly
 * named function so nothing ever claims a redshift for an ordinary star.
 */
export function buildGaiaQsoAdql(params: GaiaConeParams): string {
  const { raStr, decStr, radiusStr, top } = coneParts(params);

  return `SELECT TOP ${top}
  source_id, ra, dec,
  redshift_qsoc
FROM gaiadr3.qso_candidates
WHERE CONTAINS(
  POINT('ICRS', ra, dec),
  CIRCLE('ICRS', ${raStr}, ${decStr}, ${radiusStr})
) = 1`;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/** Coerce a raw cell to a finite float, mapping null/missing/non-numeric → NaN. */
function toFloat(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return NaN;
}

/** Normalise RA into [0,360) — matches the overlay/index convention. */
function normalizeRa(ra: number): number {
  if (!Number.isFinite(ra)) return ra;
  return ((ra % 360) + 360) % 360;
}

/**
 * Parse a Gaia TAP JSON response ({ metadata:[{name}], data:[[...]] }) into a
 * columnar {@link GaiaCatalog}. Columns are located BY metadata name (the query
 * SELECT order is NOT assumed), so a re-ordered metadata array still maps every
 * value to the right field.
 *
 * Honesty / failure modes:
 *   - Missing/empty/non-array `metadata` → THROWS (a Gaia result always describes
 *     its columns; an empty-metadata body is malformed, not an empty field).
 *   - Missing/absent `ra` or `dec` column → THROWS (a positional catalog with no
 *     position is a schema mismatch, not something to silently fill with NaN).
 *   - `data: []` with valid metadata → a VALID empty catalog (count 0), NOT a throw.
 *   - null / missing numeric cells → NaN (Gaia leaves radial_velocity, teff, and
 *     sometimes colour/parallax null for many sources — that is real, not an error).
 *   - `source_id` is preserved as a decimal STRING exactly as received (a 64-bit id
 *     would lose its low digits if coerced through a JS number).
 */
export function parseGaiaResponse(raw: unknown): GaiaCatalog {
  if (!raw || typeof raw !== 'object') {
    throw new Error('parseGaiaResponse: expected a Gaia TAP JSON object with metadata/data');
  }
  const obj = raw as Record<string, unknown>;
  const metadata = obj.metadata;
  if (!Array.isArray(metadata) || metadata.length === 0) {
    throw new Error(
      'parseGaiaResponse: malformed Gaia response — missing or empty `metadata` ' +
        '(cannot map columns by name)'
    );
  }

  // Build a case-insensitive column-name → index map (Gaia returns lower-case names).
  const colIndex = new Map<string, number>();
  metadata.forEach((field, i) => {
    const name =
      field && typeof field === 'object'
        ? ((field as Record<string, unknown>).name ?? (field as Record<string, unknown>).ID)
        : undefined;
    if (typeof name === 'string') {
      colIndex.set(name.toLowerCase(), i);
    }
  });

  const raIdx = colIndex.get('ra');
  const decIdx = colIndex.get('dec');
  if (raIdx === undefined || decIdx === undefined) {
    throw new Error(
      'parseGaiaResponse: malformed Gaia response — metadata has no `ra`/`dec` ' +
        `column. Got: [${[...colIndex.keys()].join(', ')}]`
    );
  }

  const data = Array.isArray(obj.data) ? (obj.data as unknown[][]) : [];
  const n = data.length;

  const sourceId: string[] = new Array<string>(n);
  const ra = new Float32Array(n);
  const dec = new Float32Array(n);
  const gMag = new Float32Array(n);
  const bpRp = new Float32Array(n);
  const pmRa = new Float32Array(n);
  const pmDec = new Float32Array(n);
  const parallax = new Float32Array(n);
  const radialVelocity = new Float32Array(n);
  const teff = new Float32Array(n);

  const idIdx = colIndex.get('source_id');
  const gIdx = colIndex.get('phot_g_mean_mag');
  const bpRpIdx = colIndex.get('bp_rp');
  const pmRaIdx = colIndex.get('pmra');
  const pmDecIdx = colIndex.get('pmdec');
  const plxIdx = colIndex.get('parallax');
  const rvIdx = colIndex.get('radial_velocity');
  const teffIdx = colIndex.get('teff_gspphot');

  const cell = (row: unknown[], idx: number | undefined): unknown =>
    idx === undefined ? undefined : row[idx];

  for (let i = 0; i < n; i++) {
    const row = data[i];
    if (!Array.isArray(row)) {
      throw new Error(`parseGaiaResponse: data row ${i} is not an array`);
    }

    // source_id: keep the exact decimal representation (string preferred; a numeric
    // cell is stringified, though a 64-bit id may already have lost precision in
    // JSON.parse — real callers should keep source_id textual end-to-end).
    const rawId = cell(row, idIdx);
    sourceId[i] =
      rawId === null || rawId === undefined ? '' : typeof rawId === 'string' ? rawId : String(rawId);

    ra[i] = normalizeRa(toFloat(row[raIdx]));
    dec[i] = toFloat(row[decIdx]);
    gMag[i] = toFloat(cell(row, gIdx));
    bpRp[i] = toFloat(cell(row, bpRpIdx));
    pmRa[i] = toFloat(cell(row, pmRaIdx));
    pmDec[i] = toFloat(cell(row, pmDecIdx));
    parallax[i] = toFloat(cell(row, plxIdx));
    radialVelocity[i] = toFloat(cell(row, rvIdx));
    teff[i] = toFloat(cell(row, teffIdx));
  }

  return {
    count: n,
    sourceId,
    ra,
    dec,
    gMag,
    bpRp,
    pmRa,
    pmDec,
    parallax,
    radialVelocity,
    teff,
  };
}

/* -------------------------------------------------------------------------- */
/* Fetch (network)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Fetch Gaia DR3 stars in a cone from the PUBLIC ESA Gaia TAP service and return
 * a columnar {@link GaiaCatalog}. No authentication is attached — Gaia is an open
 * service (see the file header); this never touches the Rubin RSP token.
 *
 * Failure modes are made VISIBLE via thrown, descriptive errors (never silent,
 * never fake rows):
 *   - network / CORS rejection → "could not reach the Gaia TAP service".
 *   - non-2xx HTTP status      → thrown with the status code and body text.
 *   - malformed body           → thrown by {@link parseGaiaResponse}.
 *   - empty field              → a VALID empty catalog (count 0), NOT an error.
 */
export async function fetchGaiaCone(params: GaiaConeParams): Promise<GaiaCatalog> {
  const adql = buildGaiaConeAdql(params);

  const body = new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: 'json',
    QUERY: adql,
  });

  let resp: Response;
  try {
    // Public service: intentionally NO Authorization header.
    resp = await fetch(GAIA_TAP_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach the Gaia TAP service at ${GAIA_TAP_SYNC_URL} ` +
        `(network or CORS error): ${message}`,
      { cause: err }
    );
  }

  if (!resp.ok) {
    let detail = '';
    try {
      detail = await resp.text();
    } catch {
      /* body may be unreadable; the status is the signal */
    }
    throw new Error(
      `Gaia TAP query failed (${resp.status}) at RA=${params.ra}, Dec=${params.dec}: ${detail}`
    );
  }

  let json: unknown;
  try {
    json = await resp.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Gaia TAP returned an unparseable JSON body: ${message}`, { cause: err });
  }

  // An empty field is a legitimate answer (count 0), surfaced by the parser.
  return parseGaiaResponse(json);
}
