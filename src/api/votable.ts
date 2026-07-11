/**
 * Dependency-free VOTable parser for the Rubin RSP TAP service.
 *
 * WHY THIS EXISTS (a validated-against-the-real-endpoint fact, not an assumption):
 * the RSP `/api/tap/sync` service ALWAYS returns a VOTable —
 * `content-type: application/x-votable+xml; serialization=binary2` — regardless of
 * the `FORMAT`/`RESPONSEFORMAT` requested, and returns an EMPTY body for
 * `FORMAT=json`. The previous client asked for JSON and called `resp.json()`,
 * which failed on the empty/HTML/XML body ("empty or unparseable JSON body") — so
 * EVERY TAP-backed feature (Rubin Objects, ForcedSource light curves, DIA alerts,
 * ObsCore cutout discovery) was broken against the live service. This was only
 * ever "tested" with a hand-invented JSON mock. See docs/rubin-api-usage.md.
 *
 * Supports the two serializations a TAP result can use:
 *   - BINARY2 (the RSP default): a base64 `<STREAM>` of rows, each prefixed by a
 *     null-mask bitfield, values big-endian per the FIELD datatype.
 *   - TABLEDATA: `<TR><TD>` text rows (used by some services / async results).
 *
 * Rows are returned as objects keyed by FIELD name (matching the shape the TAP
 * adapters — rubinObjects/lightcurve/diaSource — already consume). 64-bit `long`
 * ids are kept as decimal STRINGS (a Gaia/Rubin id exceeds 2^53; a JS number would
 * silently lose its low digits — the same precision trap as TODO 134).
 *
 * Uses only Web platform APIs available in the browser AND the jsdom test env:
 * `DOMParser`, `atob`, `DataView`. No XML/VOTable dependency is added.
 */

export interface VotableField {
  name: string;
  datatype: string;
  arraysize: string | null;
  unit?: string;
  description?: string;
}

export interface VotableResult {
  /** QUERY_STATUS from the VOTable ('OK' | 'OVERFLOW' | 'ERROR'); 'OK' if absent. */
  status: string;
  fields: VotableField[];
  rows: Record<string, unknown>[];
}

/** Decode a base64 string to a byte array (browser/jsdom `atob`). */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Number of bytes a FIXED-length field of this datatype occupies (per element). */
function elementSize(datatype: string): number {
  switch (datatype) {
    case 'boolean':
    case 'unsignedByte':
      return 1;
    case 'short':
      return 2;
    case 'int':
    case 'float':
      return 4;
    case 'long':
    case 'double':
      return 8;
    case 'char':
      return 1;
    case 'unicodeChar':
      return 2;
    default:
      throw new Error(`VOTable: unsupported datatype "${datatype}"`);
  }
}

/** Whether the arraysize marks a VARIABLE-length field ("*" or "n*"). */
function isVariableLength(arraysize: string | null): boolean {
  return arraysize != null && arraysize.includes('*');
}

/** Fixed element count from an arraysize like "6" (1 when scalar/absent). */
function fixedCount(arraysize: string | null): number {
  if (!arraysize) return 1;
  const n = parseInt(arraysize, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Read one field's value from `dv` at `off`; returns the decoded value and the
 * number of bytes consumed. `char`/`unicodeChar` decode to a string; other types
 * to a number (or a decimal STRING for `long`, to preserve 64-bit precision).
 */
function readField(dv: DataView, off: number, f: VotableField): { value: unknown; bytesRead: number } {
  const dt = f.datatype;
  const elem = elementSize(dt);

  // Character strings.
  if (dt === 'char' || dt === 'unicodeChar') {
    let count: number;
    let start = off;
    if (isVariableLength(f.arraysize)) {
      count = dv.getInt32(off); // 4-byte length prefix
      start = off + 4;
    } else {
      count = fixedCount(f.arraysize);
    }
    let s = '';
    for (let i = 0; i < count; i++) {
      const code = dt === 'char' ? dv.getUint8(start + i * elem) : dv.getUint16(start + i * elem);
      if (code !== 0) s += String.fromCharCode(code);
    }
    const bytesRead = (isVariableLength(f.arraysize) ? 4 : 0) + count * elem;
    return { value: s.replace(/\0+$/, '').trimEnd(), bytesRead };
  }

  // Numeric ARRAYS are not selected by this app's queries — fail loudly rather
  // than silently misalign the whole row.
  if (f.arraysize && f.arraysize !== '1') {
    throw new Error(`VOTable: numeric array field "${f.name}" (arraysize ${f.arraysize}) not supported`);
  }

  let value: unknown;
  switch (dt) {
    case 'boolean': {
      const c = dv.getUint8(off);
      value = c === 0x54 || c === 0x74 || c === 0x31; // 'T'/'t'/'1'
      break;
    }
    case 'unsignedByte':
      value = dv.getUint8(off);
      break;
    case 'short':
      value = dv.getInt16(off);
      break;
    case 'int':
      value = dv.getInt32(off);
      break;
    case 'long':
      // 64-bit id → decimal string (a JS number would lose precision > 2^53).
      value = dv.getBigInt64(off).toString();
      break;
    case 'float':
      value = dv.getFloat32(off);
      break;
    case 'double':
      value = dv.getFloat64(off);
      break;
    default:
      throw new Error(`VOTable: unsupported datatype "${dt}"`);
  }
  return { value, bytesRead: elem };
}

/** Parse the FIELD descriptors of the first results TABLE, in order. */
function parseFields(table: Element): VotableField[] {
  const fields: VotableField[] = [];
  for (const el of Array.from(table.getElementsByTagName('FIELD'))) {
    fields.push({
      name: el.getAttribute('name') ?? el.getAttribute('ID') ?? 'col',
      datatype: el.getAttribute('datatype') ?? 'char',
      arraysize: el.getAttribute('arraysize'),
      unit: el.getAttribute('unit') ?? undefined,
    });
  }
  return fields;
}

/** Decode BINARY2 rows from the base64 stream. */
function parseBinary2(streamB64: string, fields: VotableField[]): Record<string, unknown>[] {
  const bytes = base64ToBytes(streamB64);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const maskBytes = Math.ceil(fields.length / 8);
  const rows: Record<string, unknown>[] = [];
  let off = 0;
  while (off + maskBytes <= bytes.length) {
    // Null mask: bit i (MSB-first within each byte) set ⇒ field i is null.
    const nulls: boolean[] = new Array(fields.length);
    for (let i = 0; i < fields.length; i++) {
      const byte = dv.getUint8(off + (i >> 3));
      nulls[i] = ((byte >> (7 - (i & 7))) & 1) === 1;
    }
    off += maskBytes;

    const row: Record<string, unknown> = {};
    let overran = false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]!;
      if (off >= bytes.length && !isVariableLength(f.arraysize)) {
        overran = true;
        break;
      }
      const { value, bytesRead } = readField(dv, off, f);
      off += bytesRead;
      row[f.name] = nulls[i] ? null : value;
    }
    if (overran) break;
    rows.push(row);
  }
  return rows;
}

/** Coerce a TABLEDATA cell string to the FIELD's JS type. */
function coerceCell(text: string, f: VotableField): unknown {
  if (text === '') return null;
  switch (f.datatype) {
    case 'long':
      return text.trim(); // keep as exact string
    case 'int':
    case 'short':
    case 'unsignedByte':
    case 'float':
    case 'double': {
      const n = Number(text);
      return Number.isFinite(n) ? n : NaN;
    }
    case 'boolean':
      return /^(t|true|1)$/i.test(text.trim());
    default:
      return text;
  }
}

/** Decode TABLEDATA `<TR><TD>` rows. */
function parseTabledata(tabledata: Element, fields: VotableField[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const tr of Array.from(tabledata.getElementsByTagName('TR'))) {
    const tds = Array.from(tr.getElementsByTagName('TD'));
    const row: Record<string, unknown> = {};
    for (let i = 0; i < fields.length; i++) {
      row[fields[i]!.name] = coerceCell(tds[i]?.textContent ?? '', fields[i]!);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a VOTable document (BINARY2 or TABLEDATA) into fields + name-keyed rows.
 * Throws a descriptive error on QUERY_STATUS=ERROR or a malformed document.
 */
export function parseVotable(xml: string): VotableResult {
  if (typeof DOMParser === 'undefined') {
    throw new Error('VOTable parsing requires DOMParser (browser or jsdom).');
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`VOTable: malformed XML — ${doc.getElementsByTagName('parsererror')[0]?.textContent ?? ''}`.trim());
  }

  // QUERY_STATUS lives in an <INFO name="QUERY_STATUS" value="OK|OVERFLOW|ERROR">.
  let status = 'OK';
  let errorText = '';
  for (const info of Array.from(doc.getElementsByTagName('INFO'))) {
    if (info.getAttribute('name') === 'QUERY_STATUS') {
      status = info.getAttribute('value') ?? 'OK';
      if (status === 'ERROR') errorText = (info.textContent ?? '').trim();
    }
  }
  if (status === 'ERROR') {
    throw new Error(`TAP query returned an error: ${errorText || 'unknown error'}`);
  }

  // The results table is the first TABLE (the RESOURCE type="results").
  const table = doc.getElementsByTagName('TABLE')[0];
  if (!table) {
    // A valid empty/aborted result may have no TABLE — treat as zero rows.
    return { status, fields: [], rows: [] };
  }
  const fields = parseFields(table);

  const tabledata = table.getElementsByTagName('TABLEDATA')[0];
  if (tabledata) {
    return { status, fields, rows: parseTabledata(tabledata, fields) };
  }
  const binary2 = table.getElementsByTagName('BINARY2')[0];
  if (binary2) {
    const stream = binary2.getElementsByTagName('STREAM')[0];
    const b64 = stream?.textContent ?? '';
    if (!b64.trim()) return { status, fields, rows: [] };
    return { status, fields, rows: parseBinary2(b64, fields) };
  }
  // No DATA element ⇒ a valid zero-row result.
  return { status, fields, rows: [] };
}
