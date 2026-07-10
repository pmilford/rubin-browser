import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildConeSearch, query, queryAsync } from '../../src/api/tap.js';
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

describe('TAP Client', () => {
  describe('buildConeSearch', () => {
    it('builds correct ADQL for Object catalog', () => {
      const adql = buildConeSearch({
        ra: 62.0,
        dec: -37.0,
        radius: 10, // arcsec
        catalog: 'Object',
      });

      expect(adql).toContain('FROM dp1.Object');
      // DP0.2 namespace against the /api/dp1 endpoint was the long-standing bug.
      expect(adql).not.toContain('dp02_dc2_catalogs');
      expect(adql).toContain('62');
      expect(adql).toContain('-37');
      expect(adql).toContain('CIRCLE');
      expect(adql).toContain('CONTAINS');
      // No `dist` column exists in DP1 — the phantom ORDER BY was removed.
      expect(adql).not.toContain('ORDER BY dist');
    });

    it('converts arcsec to degrees', () => {
      const adql = buildConeSearch({
        ra: 0,
        dec: 0,
        radius: 3600, // 1 degree
        catalog: 'Source',
      });

      expect(adql).toContain('1)'); // 3600 arcsec = 1 degree
    });

    it('respects maxRecords', () => {
      const adql = buildConeSearch({
        ra: 0,
        dec: 0,
        radius: 60,
        catalog: 'DiaObject',
        maxRecords: 50,
      });

      expect(adql).toContain('TOP 50');
    });
  });

  describe('query', () => {
    beforeEach(() => {
      clearToken();
      mockStorage.clear();
      vi.restoreAllMocks();
    });

    it('sends ADQL to sync endpoint', async () => {
      const mockResponse = {
        metadata: { fields: [{ name: 'objectId', datatype: 'long' }] },
        data: [{ objectId: '12345' }],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      setToken('test-token');
      const result = await query('SELECT TOP 1 * FROM Object');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sync'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );

      expect(result.status).toBe('completed');
      expect(result.rowCount).toBe(1);
      expect(result.columns[0].name).toBe('objectId');
    });

    it('throws a clear error when a 200 returns HTML, not JSON (wrong endpoint / SPA)', async () => {
      // The RSP portal SPA answers unregistered routes (e.g. the old /api/dp1/sync)
      // with a 200 HTML page; surface that honestly, not a cryptic JSON.parse error.
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (h: string) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) },
        text: () => Promise.resolve('<!DOCTYPE html><html><body>Rubin Science Platform</body></html>'),
        json: () => Promise.reject(new Error('Unexpected token <')),
      });
      setToken('test-token');
      await expect(query('SELECT 1')).rejects.toThrow(/non-JSON response/i);
    });

    it('still parses JSON when the content-type header says json', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
        json: () => Promise.resolve({ metadata: { fields: [{ name: 'x', datatype: 'int' }] }, data: [{ x: 1 }] }),
      });
      setToken('test-token');
      const result = await query('SELECT 1');
      expect(result.rowCount).toBe(1);
    });

    it('throws on HTTP error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      setToken('bad-token');
      await expect(query('SELECT * FROM Object')).rejects.toThrow('401');
    });

    it('works without auth header when no token', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ metadata: { fields: [] }, data: [] }),
      });

      await query('SELECT TOP 1 * FROM Object');

      const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it('parses response with no metadata key', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ x: 1 }] }),
      });

      const result = await query('SELECT 1');
      expect(result.columns).toEqual([]);
      expect(result.rowCount).toBe(1);
    });

    it('parses response using rows instead of data', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rows: [{ a: 1 }, { a: 2 }] }),
      });

      const result = await query('SELECT 1');
      expect(result.rowCount).toBe(2);
    });

    it('parses response with no data and no rows', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await query('SELECT 1');
      expect(result.rows).toEqual([]);
      expect(result.rowCount).toBe(0);
    });

    it('parses columns with ID fallback and no name', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            metadata: {
              fields: [
                { ID: 'col_id', datatype: 'int' },
                {},
              ],
            },
            data: [],
          }),
      });

      const result = await query('SELECT 1');
      expect(result.columns[0].name).toBe('col_id');
      expect(result.columns[0].datatype).toBe('int');
      expect(result.columns[1].name).toBe('unknown');
      expect(result.columns[1].datatype).toBe('string');
    });

    it('parses columns with missing datatype', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            metadata: { fields: [{ name: 'x' }] },
            data: [],
          }),
      });

      const result = await query('SELECT 1');
      expect(result.columns[0].datatype).toBe('string');
    });

    it('returns raw text for non-JSON format', async () => {
      const csvText = 'objectId,ra,dec\n12345,62.0,-37.0';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(csvText),
      });

      setToken('test-token');
      const result = await query('SELECT * FROM Object', { format: 'csv' });

      expect(result.status).toBe('completed');
      expect(result.rowCount).toBe(0);
      expect(result.columns).toEqual([{ name: 'raw', datatype: 'string' }]);
      expect(result.rows).toEqual([{ raw: csvText }]);
    });
  });

  describe('queryAsync', () => {
    beforeEach(() => {
      clearToken();
      mockStorage.clear();
      vi.restoreAllMocks();
    });

    it('submits job, polls, and returns JSON results', async () => {
      setToken('async-token');

      const jobUrl = 'https://data.lsst.cloud/api/dp1/async/job123';
      const mockResult = {
        metadata: { fields: [{ name: 'objectId', datatype: 'long' }] },
        data: [{ objectId: '999' }],
      };

      let pollCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/async')) {
          // Submit response
          return Promise.resolve({
            ok: true,
            headers: new Headers({ Location: jobUrl }),
          });
        }
        if (url.endsWith('/phase')) {
          // First poll returns EXECUTING, second returns COMPLETED
          pollCount++;
          const phase = pollCount >= 2 ? 'COMPLETED' : 'EXECUTING';
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(phase),
          });
        }
        if (url.endsWith('/results/result')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockResult),
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      // Use a short timeout but long enough for the test
      const result = await queryAsync('SELECT * FROM Object', { asyncTimeout: 60000 });

      expect(result.status).toBe('completed');
      expect(result.rowCount).toBe(1);
      expect(result.columns[0].name).toBe('objectId');
    });

    it('returns raw text for non-JSON async results', async () => {
      setToken('async-token');

      const jobUrl = 'https://data.lsst.cloud/api/dp1/async/job456';
      const votableText = '<VOTABLE>...</VOTABLE>';

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/async')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ Location: jobUrl }),
          });
        }
        if (url.endsWith('/phase')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('COMPLETED'),
          });
        }
        if (url.endsWith('/results/result')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(votableText),
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const result = await queryAsync('SELECT * FROM Object', { format: 'votable' });

      expect(result.status).toBe('completed');
      expect(result.rowCount).toBe(0);
      expect(result.columns).toEqual([{ name: 'raw', datatype: 'string' }]);
      expect(result.rows).toEqual([{ raw: votableText }]);
    });

    it('throws when submit fails', async () => {
      setToken('async-token');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(queryAsync('SELECT * FROM Object')).rejects.toThrow(
        'Async TAP submit failed (500)'
      );
    });

    it('throws when no job location returned', async () => {
      setToken('async-token');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(), // no Location header
      });

      await expect(queryAsync('SELECT * FROM Object')).rejects.toThrow(
        'No job location returned'
      );
    });

    it('throws when job errors', async () => {
      setToken('async-token');

      const jobUrl = 'https://data.lsst.cloud/api/dp1/async/joberr';

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/async')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ Location: jobUrl }),
          });
        }
        if (url.endsWith('/phase')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('ERROR'),
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      await expect(queryAsync('SELECT * FROM Object')).rejects.toThrow(
        'Async TAP query failed'
      );
    });

    it('throws on timeout', async () => {
      setToken('async-token');

      const jobUrl = 'https://data.lsst.cloud/api/dp1/async/jobtimeout';

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/async')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ Location: jobUrl }),
          });
        }
        if (url.endsWith('/phase')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('EXECUTING'),
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      await expect(
        queryAsync('SELECT * FROM Object', { asyncTimeout: 0 })
      ).rejects.toThrow('Async TAP query timed out');
    });
  });
});
