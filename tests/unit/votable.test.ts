import { describe, it, expect } from 'vitest';
import { parseVotable } from '../../src/api/votable.js';

/**
 * Unit coverage for the VOTable parser across BOTH serializations and every
 * datatype the RSP TAP service can return. The real-wire regression lives in
 * tests/regression/votable.regression.test.ts (a captured live binary2 response);
 * here we hand-encode known values so each datatype + the null mask + variable
 * length strings are asserted against a KNOWN ground truth.
 */

/** Field spec for the binary2 builder. */
interface FieldSpec {
  name: string;
  datatype: string;
  arraysize?: string;
}

/** Encode one value into `dv` at `off`, returning bytes written (fixed-size). */
function writeValue(dv: DataView, off: number, f: FieldSpec, v: unknown): number {
  switch (f.datatype) {
    case 'boolean':
      dv.setUint8(off, v ? 0x54 : 0x46);
      return 1;
    case 'short':
      dv.setInt16(off, v as number);
      return 2;
    case 'int':
      dv.setInt32(off, v as number);
      return 4;
    case 'long':
      dv.setBigInt64(off, BigInt(v as string));
      return 8;
    case 'float':
      dv.setFloat32(off, v as number);
      return 4;
    case 'double':
      dv.setFloat64(off, v as number);
      return 8;
    case 'char': {
      const s = String(v ?? '');
      if (f.arraysize && f.arraysize.includes('*')) {
        dv.setInt32(off, s.length);
        for (let i = 0; i < s.length; i++) dv.setUint8(off + 4 + i, s.charCodeAt(i));
        return 4 + s.length;
      }
      const n = f.arraysize ? parseInt(f.arraysize, 10) : 1;
      for (let i = 0; i < n; i++) dv.setUint8(off + i, i < s.length ? s.charCodeAt(i) : 0);
      return n;
    }
    default:
      throw new Error(`test builder: unhandled ${f.datatype}`);
  }
}

/** Build a BINARY2 VOTable string from fields + rows (values, or null). */
function buildBinary2(fields: FieldSpec[], rows: unknown[][]): string {
  const maskBytes = Math.ceil(fields.length / 8);
  const buf = new ArrayBuffer(4096);
  const dv = new DataView(buf);
  let off = 0;
  for (const row of rows) {
    // null mask (MSB-first within each byte)
    for (let m = 0; m < maskBytes; m++) dv.setUint8(off + m, 0);
    for (let i = 0; i < fields.length; i++) {
      if (row[i] === null) dv.setUint8(off + (i >> 3), dv.getUint8(off + (i >> 3)) | (1 << (7 - (i & 7))));
    }
    off += maskBytes;
    for (let i = 0; i < fields.length; i++) {
      // Even null fixed fields occupy their bytes (write a placeholder value).
      const v = row[i] === null ? placeholder(fields[i]!) : row[i];
      off += writeValue(dv, off, fields[i]!, v);
    }
  }
  const bytes = new Uint8Array(buf, 0, off);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  const fieldXml = fields
    .map(
      (f, i) =>
        `<FIELD name="${f.name}" datatype="${f.datatype}"${f.arraysize ? ` arraysize="${f.arraysize}"` : ''} ID="c${i}"/>`
    )
    .join('');
  return `<?xml version="1.0"?><VOTABLE version="1.4"><RESOURCE type="results"><INFO name="QUERY_STATUS" value="OK"/><TABLE>${fieldXml}<DATA><BINARY2><STREAM encoding='base64'>${b64}</STREAM></BINARY2></DATA></TABLE></RESOURCE></VOTABLE>`;
}

function placeholder(f: FieldSpec): unknown {
  if (f.datatype === 'long') return '0';
  if (f.datatype === 'char') return '';
  if (f.datatype === 'boolean') return false;
  return 0;
}

describe('parseVotable — binary2 datatypes', () => {
  const fields: FieldSpec[] = [
    { name: 'flag', datatype: 'boolean' },
    { name: 's', datatype: 'short' },
    { name: 'i', datatype: 'int' },
    { name: 'id', datatype: 'long' },
    { name: 'f', datatype: 'float' },
    { name: 'd', datatype: 'double' },
    { name: 'code', datatype: 'char', arraysize: '4' },
    { name: 'label', datatype: 'char', arraysize: '*' },
  ];

  it('decodes every scalar datatype to its known value (long as exact string)', () => {
    const xml = buildBinary2(fields, [[true, 1000, -5, '592913157106713732', 1.5, 2.25, 'abcd', 'hi']]);
    const { rows } = parseVotable(xml);
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.flag).toBe(true);
    expect(r.s).toBe(1000);
    expect(r.i).toBe(-5);
    expect(r.id).toBe('592913157106713732'); // 64-bit long → exact string
    expect(r.f).toBeCloseTo(1.5, 6);
    expect(r.d).toBeCloseTo(2.25, 12);
    expect(r.code).toBe('abcd');
    expect(r.label).toBe('hi');
  });

  it('honours the null mask (a masked field is null, not a fabricated 0/empty)', () => {
    const xml = buildBinary2(fields, [[false, 7, 8, null, 3.5, 4.5, 'zzzz', 'ok']]);
    const r = parseVotable(xml).rows[0]!;
    expect(r.id).toBeNull(); // long masked null
    expect(r.i).toBe(8); // neighbours still correct (byte alignment preserved)
    expect(r.d).toBeCloseTo(4.5, 12);
  });

  it('decodes multiple rows and a variable-length string of differing lengths', () => {
    const xml = buildBinary2(fields, [
      [true, 1, 1, '10', 1, 1, 'aaaa', 'x'],
      [false, 2, 2, '20', 2, 2, 'bbbb', 'longer'],
    ]);
    const rows = parseVotable(xml).rows;
    expect(rows.length).toBe(2);
    expect(rows[0]!.label).toBe('x');
    expect(rows[1]!.label).toBe('longer');
    expect(rows[1]!.id).toBe('20');
  });
});

describe('parseVotable — TABLEDATA + status/errors', () => {
  function tabledata(status: string, rows: string[][]): string {
    const fx = '<FIELD name="a" datatype="int"/><FIELD name="b" datatype="long"/><FIELD name="c" datatype="char" arraysize="*"/>';
    const rx = rows.map((r) => `<TR>${r.map((v) => `<TD>${v}</TD>`).join('')}</TR>`).join('');
    return `<?xml version="1.0"?><VOTABLE><RESOURCE type="results"><INFO name="QUERY_STATUS" value="${status}"/><TABLE>${fx}<DATA><TABLEDATA>${rx}</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>`;
  }

  it('parses TABLEDATA, coercing by datatype and keeping long as a string', () => {
    const { rows } = parseVotable(tabledata('OK', [['3', '592913157106713732', 'hello'], ['', '5', '']]));
    expect(rows[0]).toEqual({ a: 3, b: '592913157106713732', c: 'hello' });
    // Empty cells → null (not 0 / "").
    expect(rows[1]!.a).toBeNull();
    expect(rows[1]!.c).toBeNull();
  });

  it('throws the ADQL error text on QUERY_STATUS=ERROR', () => {
    const xml =
      `<?xml version="1.0"?><VOTABLE><RESOURCE type="results"><INFO name="QUERY_STATUS" value="ERROR">bad column foo</INFO></RESOURCE></VOTABLE>`;
    expect(() => parseVotable(xml)).toThrow(/bad column foo/);
  });

  it('reports OVERFLOW status but still returns the rows', () => {
    const { status, rows } = parseVotable(tabledata('OVERFLOW', [['1', '2', 'z']]));
    expect(status).toBe('OVERFLOW');
    expect(rows.length).toBe(1);
  });

  it('returns zero rows for a valid table with no DATA element', () => {
    const xml =
      `<?xml version="1.0"?><VOTABLE><RESOURCE type="results"><INFO name="QUERY_STATUS" value="OK"/><TABLE><FIELD name="a" datatype="int"/></TABLE></RESOURCE></VOTABLE>`;
    const { rows, fields } = parseVotable(xml);
    expect(rows).toEqual([]);
    expect(fields[0]!.name).toBe('a');
  });

  it('throws a descriptive error on malformed XML', () => {
    expect(() => parseVotable('<VOTABLE><RESOURCE <<<')).toThrow(/VOTable/i);
  });
});
