/**
 * Build a VOTable TABLEDATA XML body for `page.route` mocks of the RSP TAP service.
 *
 * The Rubin TAP client (`src/api/tap.ts`) reads `resp.text()` and parses VOTable —
 * it does NOT parse JSON (the RSP CADC TAP only ever serialises VOTable binary2 and
 * returns an empty body for `FORMAT=json`; see CLAUDE.md). A mock that returns JSON
 * therefore parses to a malformed-XML error / zero rows and nothing renders. This
 * helper emits the TABLEDATA serialization `src/api/votable.ts::parseTabledata`
 * consumes, so a mock's rows survive the real parse path exactly.
 *
 * Datatypes are inferred from the first non-null cell per column: number → double,
 * boolean → boolean, else char (string — which also preserves 64-bit `long` ids
 * like an objectId without precision loss).
 */
export function votableFromRows(rows: Record<string, unknown>[]): string {
  const cols = rows.length ? Object.keys(rows[0]!) : [];
  const datatypeOf = (col: string): string => {
    const sample = rows.map((r) => r[col]).find((v) => v != null);
    if (typeof sample === 'number') return 'double';
    if (typeof sample === 'boolean') return 'boolean';
    return 'char';
  };
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fields = cols
    .map((c) => {
      const dt = datatypeOf(c);
      return `<FIELD name="${c}" datatype="${dt}"${dt === 'char' ? ' arraysize="*"' : ''}/>`;
    })
    .join('');
  const trs = rows
    .map((r) => `<TR>${cols.map((c) => `<TD>${r[c] == null ? '' : esc(String(r[c]))}</TD>`).join('')}</TR>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<VOTABLE version="1.4" xmlns="http://www.ivoa.net/xml/VOTable/v1.3">
<RESOURCE type="results">
<INFO name="QUERY_STATUS" value="OK"/>
<TABLE>${fields}<DATA><TABLEDATA>${trs}</TABLEDATA></DATA></TABLE>
</RESOURCE>
</VOTABLE>`;
}
