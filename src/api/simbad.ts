/**
 * SIMBAD client — driven by the PUBLIC CDS SIMBAD TAP service.
 *
 * Powers the "what's here? / resolve name" feature: given a sky position it lists
 * the catalogued objects in a small cone; given an identifier (e.g. "M31",
 * "Barnard's Star") it resolves that name to coordinates.
 *
 * Like the Gaia client in this directory, SIMBAD is an OPEN, un-authenticated
 * service: the CDS SIMBAD TAP endpoint takes anonymous queries and does NOT use
 * the Rubin RSP token. This module therefore deliberately does NOT import or call
 * `getAuthHeader()` / `isAuthenticated()` from `./auth.js` — attaching a Rubin
 * bearer token to a CDS request would be wrong and pointless. (Along with
 * `gaia.ts`, this is an auth-free client by design.)
 *
 * Endpoint + protocol (IVOA TAP sync):
 *   POST https://simbad.cds.unistra.fr/simbad/sim-tap/sync
 *   form params: REQUEST=doQuery, LANG=ADQL, FORMAT=json, QUERY=<adql>
 *   response JSON shape: { metadata: [{ name, datatype, ... }], data: [[...], ...] }
 *   (columns are addressed BY metadata name — never by positional index — because
 *   the archive does not guarantee column order matches the SELECT list.)
 *
 * Scope / honesty:
 *   - Main table is `basic` (columns: `main_id`, `ra`, `dec` in ICRS degrees,
 *     `otype_txt` the object type e.g. 'Galaxy'/'Star', `oid` the internal id).
 *     We stay on `basic` alone for cone queries to remain robust (no flux joins).
 *   - Name resolution joins `basic` to the `ident` cross-identifier table
 *     (`ident.oidref = basic.oid`) so any known alias resolves to the object.
 *
 * All coordinates are DEGREES at the ADQL boundary (ICRS). Cone RADIUS is supplied
 * in ARCSEC ({@link SimbadConeParams.radiusArcsec}) and converted to degrees here.
 */

/** The public CDS SIMBAD TAP synchronous endpoint (no auth). */
export const SIMBAD_TAP_SYNC_URL = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';

/** Default row cap for a SIMBAD cone query (TOP N in the ADQL). */
export const SIMBAD_DEFAULT_MAX_ROWS = 20;

/**
 * One SIMBAD object. Positions are ICRS DEGREES; `separationArcsec` is the angular
 * distance from the cone centre (present for cone results, absent for name
 * resolution).
 */
export interface SimbadObject {
  /** Primary identifier, e.g. "M  31", "NAME Barnard's star". */
  mainId: string;
  /** Right ascension, degrees (ICRS). */
  ra: number;
  /** Declination, degrees (ICRS). */
  dec: number;
  /** Object type text, e.g. 'Galaxy', 'Star' (`otype_txt`); '' if unknown. */
  objectType: string;
  /** Angular separation from the cone centre, arcsec (cone results only). */
  separationArcsec?: number;
}

export interface SimbadConeParams {
  /** Right ascension of the cone centre, degrees (ICRS). */
  ra: number;
  /** Declination of the cone centre, degrees (ICRS). */
  dec: number;
  /** Cone-search radius in ARCSEC (converted to degrees for the ADQL CIRCLE). */
  radiusArcsec: number;
  /** Row cap for the query. Default {@link SIMBAD_DEFAULT_MAX_ROWS}. */
  maxRows?: number;
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

/**
 * Escape a string literal for interpolation into single-quoted ADQL: SQL escapes a
 * single quote by DOUBLING it, so `Barnard's Star` → `Barnard''s Star`. This keeps
 * an apostrophe in an identifier from prematurely closing the quoted string.
 */
function escapeAdqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Build a cone-search ADQL query for SIMBAD objects around a sky position.
 *
 * Queries the `basic` table alone (robust — no flux joins), selecting id, ICRS
 * position, and object-type text, plus a computed `sep` separation (degrees) used
 * to ORDER the rows NEAREST-first. Radius is supplied in ARCSEC and converted to
 * DEGREES here (TAP CIRCLE wants degrees); ra/dec/radius are finite-checked, so
 * nothing user-controlled is interpolated as an un-vetted string. Rows with a null
 * `ra` are excluded (an un-positioned SIMBAD entry is useless to the overlay).
 */
export function buildConeAdql(params: SimbadConeParams): string {
  const raDeg = finiteNumber(params.ra, 'ra');
  const decDeg = finiteNumber(params.dec, 'dec');
  const radiusArcsec = finiteNumber(params.radiusArcsec, 'radiusArcsec');
  if (radiusArcsec <= 0) {
    throw new Error(`Invalid radiusArcsec: must be > 0, got ${radiusArcsec}`);
  }
  const radiusDeg = radiusArcsec / 3600; // arcsec → degrees at the boundary
  const top = Math.max(
    1,
    Math.floor(finiteNumber(params.maxRows ?? SIMBAD_DEFAULT_MAX_ROWS, 'maxRows'))
  );

  const raStr = formatNum(raDeg);
  const decStr = formatNum(decDeg);
  const radiusStr = formatNum(radiusDeg);

  return `SELECT TOP ${top}
  main_id, ra, dec, otype_txt,
  DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', ${raStr}, ${decStr})) AS sep
FROM basic
WHERE CONTAINS(
  POINT('ICRS', ra, dec),
  CIRCLE('ICRS', ${raStr}, ${decStr}, ${radiusStr})
) = 1
  AND ra IS NOT NULL
ORDER BY sep`;
}

/**
 * Build a name-resolution ADQL query: resolve an identifier (any SIMBAD alias) to
 * its object by joining `basic` to the `ident` cross-identifier table on
 * `ident.oidref = basic.oid`. The name is matched exactly against `ident.id` and is
 * escaped (single quotes doubled) so an apostrophe cannot break the quoted literal.
 */
export function buildResolveAdql(name: string): string {
  if (typeof name !== 'string') {
    throw new Error(`Invalid name: expected a string, got ${String(name)}`);
  }
  const safe = escapeAdqlString(name);
  return `SELECT TOP 1
  b.main_id, b.ra, b.dec, b.otype_txt
FROM basic AS b
JOIN ident AS i ON i.oidref = b.oid
WHERE i.id = '${safe}'`;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/** Coerce a raw cell to a finite float, mapping null/missing/non-numeric → null. */
function toFloatOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

/**
 * Parse a SIMBAD TAP JSON response ({ metadata:[{name}], data:[[...]] }) into a
 * list of {@link SimbadObject}. Columns are located BY metadata name (the SELECT
 * order is NOT assumed), so a re-ordered metadata array still maps every value to
 * the right field.
 *
 * Honesty / failure modes:
 *   - Missing/empty/non-array `metadata` → THROWS (a SIMBAD result always describes
 *     its columns; an empty-metadata body is malformed, not an empty field).
 *   - `data: []` with valid metadata → a VALID empty list `[]`, NOT a throw.
 *   - Rows with a null/missing `ra` or `dec` are SKIPPED (an un-positioned entry
 *     cannot be placed on the sky), not emitted with NaN coordinates.
 *   - `sep` (degrees, when present) is surfaced as `separationArcsec` (× 3600).
 */
export function parseSimbadResponse(raw: unknown): SimbadObject[] {
  if (!raw || typeof raw !== 'object') {
    throw new Error('parseSimbadResponse: expected a SIMBAD TAP JSON object with metadata/data');
  }
  const obj = raw as Record<string, unknown>;
  const metadata = obj.metadata;
  if (!Array.isArray(metadata) || metadata.length === 0) {
    throw new Error(
      'parseSimbadResponse: malformed SIMBAD response — missing or empty `metadata` ' +
        '(cannot map columns by name)'
    );
  }

  // Build a case-insensitive column-name → index map (SIMBAD returns lower-case names).
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

  const idIdx = colIndex.get('main_id');
  const raIdx = colIndex.get('ra');
  const decIdx = colIndex.get('dec');
  const otypeIdx = colIndex.get('otype_txt');
  const sepIdx = colIndex.get('sep');

  const data = Array.isArray(obj.data) ? (obj.data as unknown[][]) : [];
  const out: SimbadObject[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!Array.isArray(row)) {
      throw new Error(`parseSimbadResponse: data row ${i} is not an array`);
    }

    const cell = (idx: number | undefined): unknown => (idx === undefined ? undefined : row[idx]);

    const ra = toFloatOrNull(cell(raIdx));
    const dec = toFloatOrNull(cell(decIdx));
    // Skip un-positioned rows rather than emitting NaN coordinates.
    if (ra === null || dec === null) continue;

    const rawId = cell(idIdx);
    const mainId = typeof rawId === 'string' ? rawId : rawId == null ? '' : String(rawId);
    const rawType = cell(otypeIdx);
    const objectType = typeof rawType === 'string' ? rawType : rawType == null ? '' : String(rawType);

    const object: SimbadObject = { mainId, ra, dec, objectType };

    const sepDeg = toFloatOrNull(cell(sepIdx));
    if (sepDeg !== null) object.separationArcsec = sepDeg * 3600;

    out.push(object);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Fetch (network)                                                            */
/* -------------------------------------------------------------------------- */

/** POST an ADQL query to the public SIMBAD TAP sync endpoint and return the JSON body. */
async function postAdql(adql: string, context: string): Promise<unknown> {
  const body = new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: 'json',
    QUERY: adql,
  });

  let resp: Response;
  try {
    // Public service: intentionally NO Authorization header.
    resp = await fetch(SIMBAD_TAP_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach the SIMBAD TAP service at ${SIMBAD_TAP_SYNC_URL} ` +
        `(network or CORS error) while ${context}: ${message}`,
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
    throw new Error(`SIMBAD TAP query failed (${resp.status}) while ${context}: ${detail}`);
  }

  try {
    return await resp.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`SIMBAD TAP returned an unparseable JSON body while ${context}: ${message}`, {
      cause: err,
    });
  }
}

/**
 * List SIMBAD objects in a cone around a position from the PUBLIC CDS SIMBAD TAP
 * service, nearest-first. No authentication is attached — SIMBAD is an open
 * service (see the file header); this never touches the Rubin RSP token.
 *
 * Failure modes are made VISIBLE via thrown, descriptive errors (never silent,
 * never fake rows):
 *   - network / CORS rejection → "could not reach the SIMBAD TAP service".
 *   - non-2xx HTTP status      → thrown with the status code and body text.
 *   - malformed body           → thrown by {@link parseSimbadResponse}.
 *   - no objects in the cone   → a VALID empty list `[]`, NOT an error.
 */
export async function objectsNear(params: SimbadConeParams): Promise<SimbadObject[]> {
  const adql = buildConeAdql(params);
  const json = await postAdql(
    adql,
    `listing objects near RA=${params.ra}, Dec=${params.dec}`
  );
  // An empty cone is a legitimate answer ([]), surfaced by the parser.
  return parseSimbadResponse(json);
}

/**
 * Resolve an identifier (e.g. "M31", "Barnard's Star") to a single SIMBAD object
 * via the PUBLIC CDS SIMBAD TAP service, or `null` if the name is unknown. No auth
 * is attached (see the file header). Network / non-ok / malformed failures throw
 * with a descriptive message; an unknown name is `null`, not a throw.
 */
export async function resolveName(name: string): Promise<SimbadObject | null> {
  const adql = buildResolveAdql(name);
  const json = await postAdql(adql, `resolving name "${name}"`);
  const objects = parseSimbadResponse(json);
  return objects.length > 0 ? objects[0]! : null;
}
