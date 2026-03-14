import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setToken,
  getToken,
  clearToken,
  isAuthenticated,
  getAuthHeader,
  validateToken,
} from '../../src/api/auth.js';

const mockStorage = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
  value: {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, value: string) => mockStorage.set(key, value),
    removeItem: (key: string) => mockStorage.delete(key),
  },
  writable: true,
});

/** Build a fake JWT with the given payload */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

describe('Auth Module', () => {
  beforeEach(() => {
    clearToken();
    mockStorage.clear();
    vi.restoreAllMocks();
  });

  describe('setToken / getToken', () => {
    it('stores and retrieves a token', () => {
      setToken('abc123');
      expect(getToken()).toBe('abc123');
    });

    it('returns null when no token is set', () => {
      expect(getToken()).toBeNull();
    });

    it('reads token from sessionStorage when not in memory', () => {
      // Directly put a token in storage without going through setToken
      mockStorage.set('rubin_rsp_token', 'stored-token');
      // clearToken() was called in beforeEach, so authState.token is null
      // getToken should fall back to sessionStorage
      const token = getToken();
      expect(token).toBe('stored-token');
    });
  });

  describe('clearToken', () => {
    it('removes token from state and storage', () => {
      setToken('to-be-cleared');
      clearToken();
      expect(getToken()).toBeNull();
      expect(mockStorage.has('rubin_rsp_token')).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    it('returns false when no token', () => {
      expect(isAuthenticated()).toBe(false);
    });

    it('returns true with valid non-expired token', () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      setToken(fakeJwt({ exp: futureExp }));
      expect(isAuthenticated()).toBe(true);
    });

    it('returns false and clears an expired token', () => {
      const pastExp = Math.floor(Date.now() / 1000) - 3600;
      setToken(fakeJwt({ exp: pastExp }));
      expect(isAuthenticated()).toBe(false);
      expect(getToken()).toBeNull();
    });

    it('returns true when token has no exp (expiresAt is null)', () => {
      setToken(fakeJwt({ sub: 'user' }));
      expect(isAuthenticated()).toBe(true);
    });
  });

  describe('getAuthHeader', () => {
    it('returns empty object when no token', () => {
      expect(getAuthHeader()).toEqual({});
    });

    it('returns Authorization header when token set', () => {
      setToken('my-token');
      expect(getAuthHeader()).toEqual({ Authorization: 'Bearer my-token' });
    });
  });

  describe('validateToken', () => {
    it('returns true when API responds ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
      const result = await validateToken('good-token');
      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('data.lsst.cloud'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer good-token',
          }),
        })
      );
    });

    it('returns false when API responds not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
      expect(await validateToken('bad-token')).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      expect(await validateToken('any-token')).toBe(false);
    });
  });

  describe('parseTokenExpiry (via setToken)', () => {
    it('parses exp from valid JWT', () => {
      const exp = Math.floor(Date.now() / 1000) + 7200;
      setToken(fakeJwt({ exp }));
      // isAuthenticated uses expiresAt — a valid future exp means authenticated
      expect(isAuthenticated()).toBe(true);
    });

    it('returns null for non-JWT token', () => {
      setToken('not-a-jwt');
      // expiresAt will be null, so isAuthenticated should still return true
      // (no expiry means we can't say it's expired)
      expect(isAuthenticated()).toBe(true);
    });

    it('returns null when JWT payload has no exp field', () => {
      setToken(fakeJwt({ sub: 'user', iat: 123 }));
      expect(isAuthenticated()).toBe(true);
    });
  });
});
