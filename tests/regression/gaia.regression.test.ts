import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGaiaResponse } from '../../src/api/gaia.js';

/**
 * REAL-DATA regression (TODO 126). The fixture in ../fixtures/ is a VERBATIM,
 * unedited response captured live from the GAVO Gaia mirror
 * (https://dc.zah.uni-heidelberg.de/tap/sync, table gaia.dr3lite) — the exact
 * service the app queries. Parsing it with JSON.parse (as the app does) and then
 * `parseGaiaResponse` locks in the real wire shape: the `columns` descriptor key
 * (NOT ESA's `metadata`), the server-derived `bp_rp` alias, `source_id` delivered
 * as a JSON STRING (via the `source_id || ''` text cast — TODO 134, so the 64-bit id
 * survives JSON.parse), and null-as-NaN — the class of thing a hand-written mock
 * silently got wrong (see the Gaia CORS migration). Regenerate with:
 *   curl -sG https://dc.zah.uni-heidelberg.de/tap/sync \
 *     --data-urlencode REQUEST=doQuery --data-urlencode LANG=ADQL \
 *     --data-urlencode FORMAT=json \
 *     --data-urlencode "QUERY=SELECT TOP 3 source_id || '' AS source_id, ra, dec, parallax, pmra, pmdec, phot_g_mean_mag, phot_bp_mean_mag - phot_rp_mean_mag AS bp_rp, radial_velocity FROM gaia.dr3lite WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',62,-37,0.05))"
 */
// vitest runs from the repo root, so a root-relative path resolves the fixture.
const raw = JSON.parse(readFileSync('tests/fixtures/gaia-dr3lite-cone.json', 'utf-8'));

describe('Gaia GAVO dr3lite — real-response regression', () => {
  it('exposes the GAVO wire shape (columns key + derived bp_rp), not the ESA metadata shape', () => {
    // The fixture must be the real GAVO shape or this regression is worthless.
    expect(Array.isArray(raw.columns)).toBe(true);
    expect(raw.metadata).toBeUndefined();
    expect(raw.columns.map((c: { name: string }) => c.name)).toContain('bp_rp');
    // TODO 134: source_id is delivered as TEXT (`source_id || ''`) so the id survives
    // JSON.parse — the descriptor datatype is `char`, not the raw `long`.
    const idCol = raw.columns.find((c: { name: string }) => c.name === 'source_id');
    expect(idCol.datatype).toBe('char');
  });

  it('parseGaiaResponse maps the live response to exact catalog values', () => {
    const cat = parseGaiaResponse(raw);
    expect(cat.count).toBe(3);
    // Reliable float columns, asserted against the captured values.
    expect(cat.ra[0]).toBeCloseTo(62.0503286, 4);
    expect(cat.dec[0]).toBeCloseTo(-37.0162791, 4);
    expect(cat.gMag[0]).toBeCloseTo(19.988161, 3);
    // bp_rp is the SERVER-derived alias (phot_bp - phot_rp); a metadata-only or
    // wrong-column parser would not surface it here.
    expect(cat.bpRp[0]).toBeCloseTo(0.6593971, 4);
    expect(cat.pmRa[1]).toBeCloseTo(20.37271, 3);
    expect(cat.parallax[1]).toBeCloseTo(1.4654369, 4);
    // radial_velocity is null in every row of this cone → NaN, never 0.
    expect(Number.isNaN(cat.radialVelocity[0])).toBe(true);
  });

  it('preserves the full 64-bit source_id EXACTLY (TODO 134 fix — text-cast on the wire)', () => {
    // The query now selects `source_id || '' AS source_id`, so GAVO emits the id as
    // a JSON STRING and JSON.parse leaves it untouched. The fixture cell is therefore
    // already a string of the TRUE id — not a rounded JS number. parseGaiaResponse
    // keeps it verbatim, so the exact 19-digit id round-trips.
    const trueId = '4845547606170801408';
    // The wire cell is a string (proves the text cast survived JSON.parse)...
    expect(typeof raw.data[0][0]).toBe('string');
    expect(raw.data[0][0]).toBe(trueId);
    // ...and would have been CORRUPTED had it come across as a bare JS number.
    // eslint-disable-next-line no-loss-of-precision -- demonstrating the precision loss the text cast avoids
    expect(String(4845547606170801408)).not.toBe(trueId);
    const cat = parseGaiaResponse(raw);
    expect(cat.sourceId[0]).toBe(trueId);
    expect(cat.sourceId[0]).toMatch(/^\d{19}$/);
  });
});
