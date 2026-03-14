import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildConeSearch, query } from '../../src/api/tap.js';
import { setToken, getAuthHeader, clearToken } from '../../src/api/auth.js';

describe('TAP Client', () => {
  describe('buildConeSearch', () => {
    it('builds correct ADQL for Object catalog', () => {
      const adql = buildConeSearch({
        ra: 62.0,
        dec: -37.0,
        radius: 10, // arcsec
        catalog: 'Object',
      });

      expect(adql).toContain('FROM dp02_dc2_catalogs.Object');
      expect(adql).toContain('62');
      expect(adql).toContain('-37');
      expect(adql).toContain('CIRCLE');
      expect(adql).toContain('CONTAINS');
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
  });
});
