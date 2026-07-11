import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setToken,
  getToken,
  clearToken,
  isAuthenticated,
  isTokenPersisted,
  getAuthHeader,
  getTokenExpiry,
  validateToken,
} from '../../src/api/auth.js';

const mockStorage = new Map<string, string>(); // sessionStorage
const mockLocal = new Map<string, string>(); // localStorage
function storageMock(m: Map<string, string>) {
  return {
    getItem: (key: string) => m.get(key) ?? null,
    setItem: (key: string, value: string) => m.set(key, value),
    removeItem: (key: string) => m.delete(key),
  };
}
Object.defineProperty(globalThis, 'sessionStorage', { value: storageMock(mockStorage), writable: true });
Object.defineProperty(globalThis, 'localStorage', { value: storageMock(mockLocal), writable: true });

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
    mockLocal.clear();
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

    it('round-trips via setToken → getToken and exposes a Bearer auth header', () => {
      setToken('round-trip-token');
      // getToken returns exactly what was set
      expect(getToken()).toBe('round-trip-token');
      // and it is persisted to sessionStorage under the canonical key
      expect(mockStorage.get('rubin_rsp_token')).toBe('round-trip-token');
      // getAuthHeader derives the Bearer header from the same token
      expect(getAuthHeader()).toEqual({ Authorization: 'Bearer round-trip-token' });
    });

    it('reads token from sessionStorage when not in memory', () => {
      // Directly put a token in storage without going through setToken
      mockStorage.set('rubin_rsp_token', 'stored-token');
      // clearToken() was called in beforeEach, so authState.token is null
      // getToken should fall back to sessionStorage
      const token = getToken();
      expect(token).toBe('stored-token');
    });

    it('persist=false keeps the token in sessionStorage only', () => {
      setToken('session-only', false);
      expect(mockStorage.get('rubin_rsp_token')).toBe('session-only');
      expect(mockLocal.has('rubin_rsp_token')).toBe(false);
      expect(isTokenPersisted()).toBe(false);
    });

    it('persist=true stores the token in localStorage (survives session)', () => {
      setToken('remembered', true);
      expect(mockLocal.get('rubin_rsp_token')).toBe('remembered');
      expect(mockStorage.has('rubin_rsp_token')).toBe(false);
      expect(isTokenPersisted()).toBe(true);
    });

    it('reads a persisted token from localStorage when not in memory', () => {
      mockLocal.set('rubin_rsp_token', 'persisted-token');
      expect(getToken()).toBe('persisted-token');
      expect(isTokenPersisted()).toBe(true);
    });

    it('switching persist=true then false moves the token between storages', () => {
      setToken('t', true);
      expect(mockLocal.has('rubin_rsp_token')).toBe(true);
      setToken('t', false);
      expect(mockLocal.has('rubin_rsp_token')).toBe(false);
      expect(mockStorage.get('rubin_rsp_token')).toBe('t');
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
      // Assert the user-info ENDPOINT PATH, not the host: requests are routed
      // through the same-origin dev proxy (/rsp/...) in a dev/test env and hit
      // data.lsst.cloud directly in prod — the path is invariant across both
      // (see src/api/rspProxy.ts::toRequestUrl).
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/api/v1/user-info'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer good-token',
          }),
        })
      );
      // Reconciliation (TODO 128): identity is validated against the Gafaelfawr
      // user-info endpoint — NOT the old, wrong `/api/dp1/query` TAP route (which
      // failed for valid tokens and conflated auth with DP1 data rights).
      const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
      expect(calledUrl).not.toContain('/api/dp1/query');
      expect(calledUrl).not.toContain('/api/dp1');
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

  describe('opaque RSP tokens (gt-…) are not JWTs', () => {
    // Real RSP tokens are opaque Gafaelfawr handles like `gt-<random>.<random>`.
    // A `.`-containing gt- token is the adversarial case: a naive JWT parser would
    // atob() the middle segment and could fabricate a bogus expiry from it.
    const OPAQUE_TOKEN = 'gt-abc123DEF456.ghi789JKL012';

    it('reports UNKNOWN (null) expiry for a gt- token — never a fabricated value', () => {
      setToken(OPAQUE_TOKEN);
      // Honest: no client-decodable expiry exists, so it must be null. A JWT-parsing
      // impl that decodes the segment after the dot would return a non-null number.
      expect(getTokenExpiry()).toBeNull();
    });

    it('treats a gt- token as present and valid-shaped (stored, authenticated, Bearer header)', () => {
      setToken(OPAQUE_TOKEN);
      expect(getToken()).toBe(OPAQUE_TOKEN);
      // Unknown expiry ⇒ not expirable client-side ⇒ authenticated until a 401.
      expect(isAuthenticated()).toBe(true);
      expect(getAuthHeader()).toEqual({ Authorization: `Bearer ${OPAQUE_TOKEN}` });
    });

    it('never self-expires a gt- token (expiry stays unknown across checks)', () => {
      setToken(OPAQUE_TOKEN);
      expect(isAuthenticated()).toBe(true);
      // A fabricated past-expiry would clear the token here; an honest null keeps it.
      expect(isAuthenticated()).toBe(true);
      expect(getToken()).toBe(OPAQUE_TOKEN);
      expect(getTokenExpiry()).toBeNull();
    });
  });
});
