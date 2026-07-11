import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { query, queryAsync } from '../../src/api/tap.js';
import { setToken, clearToken } from '../../src/api/auth.js';

const mockStorage = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
  value: {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, value: string) => mockStorage.set(key, value),
    removeItem: (key: string) => mockStorage.delete(key),
  },
  writable: true,
});

// The VERBATIM live RSP TAP response (VOTable binary2) — the shape the service
// ACTUALLY returns (validated against data.lsst.cloud). Using the real fixture is
// the whole point: the old tests mocked an invented JSON shape and hid that every
// live TAP call was broken.
const REAL_VOT = readFileSync('tests/fixtures/dp1-object-cone.vot.xml', 'utf-8');

/** Build a minimal TABLEDATA VOTable for synthetic unit cases. */
function tabledataVot(fields: { name: string; datatype: string }[], rows: string[][], status = 'OK'): string {
  const fieldXml = fields
    .map((f, i) => `<FIELD name="${f.name}" datatype="${f.datatype}" ID="c${i}"/>`)
    .join('');
  const rowXml = rows.map((r) => `<TR>${r.map((v) => `<TD>${v}</TD>`).join('')}</TR>`).join('');
  return `<?xml version="1.0"?><VOTABLE version="1.4"><RESOURCE type="results"><INFO name="QUERY_STATUS" value="${status}"/><TABLE>${fieldXml}<DATA><TABLEDATA>${rowXml}</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>`;
}

function mockText(text: string, ok = true, status = 200): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(text),
  });
}

describe('TAP Client', () => {
  describe('query', () => {
    beforeEach(() => {
      clearToken();
      mockStorage.clear();
      vi.restoreAllMocks();
    });

    it('POSTs ADQL + bearer to /sync and parses the REAL binary2 VOTable to rows', async () => {
      mockText(REAL_VOT);
      setToken('test-token');
      const result = await query('SELECT TOP 2 objectId, coord_ra, coord_dec, r_psfMag FROM dp1.Object');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sync'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      );
      expect(result.status).toBe('completed');
      expect(result.rowCount).toBe(2);
      expect(result.columns[0].name).toBe('objectId');
      // objectId is a 64-bit long preserved as an EXACT string (not a rounded number).
      expect(result.rows[0].objectId).toBe('592913157106713732');
      expect(result.rows[0].coord_ra as number).toBeCloseTo(59.281075, 5);
    });

    it('parses a TABLEDATA VOTable, keying rows by column name', async () => {
      mockText(tabledataVot([{ name: 'x', datatype: 'int' }, { name: 'y', datatype: 'double' }], [['1', '2.5'], ['3', '4.5']]));
      const result = await query('SELECT 1');
      expect(result.rowCount).toBe(2);
      expect(result.rows[1]).toEqual({ x: 3, y: 4.5 });
    });

    it('surfaces an EMPTY 200 body as an honest data-rights error (the live symptom)', async () => {
      // FORMAT=json returns an empty body from the RSP; a session without DP1 rights
      // also yields empty. Must be actionable, not a cryptic parse failure.
      mockText('   ');
      setToken('test-token');
      await expect(query('SELECT 1')).rejects.toThrow(/empty response body/i);
    });

    it('surfaces an HTML 200 body (wrong endpoint / SPA) honestly', async () => {
      mockText('<!DOCTYPE html><html><body>Rubin Science Platform</body></html>');
      setToken('test-token');
      await expect(query('SELECT 1')).rejects.toThrow(/HTML instead of a VOTable/i);
    });

    it('throws the ADQL error from a QUERY_STATUS=ERROR VOTable', async () => {
      const errVot =
        `<?xml version="1.0"?><VOTABLE version="1.4"><RESOURCE type="results">` +
        `<INFO name="QUERY_STATUS" value="ERROR">Unknown column 'nope'</INFO></RESOURCE></VOTABLE>`;
      mockText(errVot);
      await expect(query('SELECT nope FROM dp1.Object')).rejects.toThrow(/Unknown column 'nope'/);
    });

    it('throws on HTTP error', async () => {
      mockText('Unauthorized', false, 401);
      setToken('bad-token');
      await expect(query('SELECT * FROM Object')).rejects.toThrow('401');
    });

    it('works without an auth header when no token', async () => {
      mockText(tabledataVot([{ name: 'x', datatype: 'int' }], []));
      await query('SELECT TOP 1 * FROM Object');
      const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it('returns zero rows (not an error) for an empty-but-valid result', async () => {
      mockText(tabledataVot([{ name: 'objectId', datatype: 'long' }], []));
      const result = await query('SELECT 1');
      expect(result.rowCount).toBe(0);
      expect(result.rows).toEqual([]);
      expect(result.columns[0].name).toBe('objectId');
    });
  });

  describe('queryAsync', () => {
    beforeEach(() => {
      clearToken();
      mockStorage.clear();
      vi.restoreAllMocks();
    });

    it('submits, polls, and parses the VOTable result', async () => {
      setToken('async-token');
      const jobUrl = 'https://data.lsst.cloud/api/tap/async/job123';
      const resultVot = tabledataVot([{ name: 'objectId', datatype: 'long' }], [['999']]);

      let pollCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/async')) return Promise.resolve({ ok: true, headers: new Headers({ Location: jobUrl }) });
        if (url.endsWith('/phase')) {
          pollCount++;
          return Promise.resolve({ ok: true, text: () => Promise.resolve(pollCount >= 2 ? 'COMPLETED' : 'EXECUTING') });
        }
        if (url.endsWith('/results/result')) return Promise.resolve({ ok: true, text: () => Promise.resolve(resultVot) });
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const result = await queryAsync('SELECT * FROM Object', { asyncTimeout: 60000 });
      expect(result.status).toBe('completed');
      expect(result.rowCount).toBe(1);
      expect(result.rows[0].objectId).toBe('999');
    });

    it('throws when submit fails', async () => {
      setToken('async-token');
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      await expect(queryAsync('SELECT * FROM Object')).rejects.toThrow('Async TAP submit failed (500)');
    });

    it('throws when no job location returned', async () => {
      setToken('async-token');
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, headers: new Headers() });
      await expect(queryAsync('SELECT * FROM Object')).rejects.toThrow('No job location returned');
    });

    it('throws when the job errors', async () => {
      setToken('async-token');
      const jobUrl = 'https://data.lsst.cloud/api/tap/async/joberr';
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/async')) return Promise.resolve({ ok: true, headers: new Headers({ Location: jobUrl }) });
        if (url.endsWith('/phase')) return Promise.resolve({ ok: true, text: () => Promise.resolve('ERROR') });
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });
      await expect(queryAsync('SELECT * FROM Object')).rejects.toThrow('Async TAP query failed');
    });

    it('throws on timeout', async () => {
      setToken('async-token');
      const jobUrl = 'https://data.lsst.cloud/api/tap/async/jobtimeout';
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/async')) return Promise.resolve({ ok: true, headers: new Headers({ Location: jobUrl }) });
        if (url.endsWith('/phase')) return Promise.resolve({ ok: true, text: () => Promise.resolve('EXECUTING') });
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });
      await expect(queryAsync('SELECT * FROM Object', { asyncTimeout: 0 })).rejects.toThrow('Async TAP query timed out');
    });
  });
});
