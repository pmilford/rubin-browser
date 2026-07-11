import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseVotable } from '../../src/api/votable.js';

/**
 * REAL-DATA regression for the RSP TAP VOTable parser. The fixture is a VERBATIM,
 * unedited response captured live from the authenticated Rubin RSP TAP service
 * (https://data.lsst.cloud/api/tap/sync, `SELECT TOP 2 objectId, coord_ra,
 * coord_dec, r_psfMag FROM dp1.Object …CIRCLE(59.29,-48.99,0.05)`) on 2026-07-11.
 *
 * It exists because the previous client assumed a JSON response shape that the
 * service NEVER returns (it always serialises VOTable binary2, and returns an
 * empty body for FORMAT=json), and that wrong assumption was only ever "tested"
 * against a hand-invented mock. This locks the REAL wire shape:
 *   - content: application/x-votable+xml; serialization=binary2
 *   - objectId is a 64-bit `long` kept as an EXACT decimal string (JS number would
 *     round its low digits — the same trap as Gaia source_id / TODO 134)
 *   - coord_ra/coord_dec (double), r_psfMag (float) decode to the captured values.
 * Regenerate with the curl in docs/rubin-api-usage.md (needs a DP1 RSP token).
 */
const xml = readFileSync('tests/fixtures/dp1-object-cone.vot.xml', 'utf-8');

describe('RSP TAP VOTable (binary2) — real-response regression', () => {
  it('parses the FIELD descriptors in order with the real datatypes', () => {
    const { fields } = parseVotable(xml);
    expect(fields.map((f) => f.name)).toEqual(['objectId', 'coord_ra', 'coord_dec', 'r_psfMag']);
    expect(fields.map((f) => f.datatype)).toEqual(['long', 'double', 'double', 'float']);
    expect(fields[1]!.unit).toBe('deg');
  });

  it('decodes the binary2 rows to the exact captured values', () => {
    const { status, rows } = parseVotable(xml);
    expect(status).toBe('OK');
    expect(rows.length).toBe(2);

    // objectId: a 64-bit long, preserved as an EXACT string (not a rounded number).
    expect(rows[0]!.objectId).toBe('592913157106713732');
    expect(rows[1]!.objectId).toBe('592913225826186547');
    expect(typeof rows[0]!.objectId).toBe('string');

    expect(rows[0]!.coord_ra as number).toBeCloseTo(59.281075, 5);
    expect(rows[0]!.coord_dec as number).toBeCloseTo(-48.98508, 5);
    expect(rows[0]!.r_psfMag as number).toBeCloseTo(26.5459, 3);
    expect(rows[1]!.coord_ra as number).toBeCloseTo(59.248273, 5);
  });
});
