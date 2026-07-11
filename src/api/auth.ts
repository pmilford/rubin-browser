/** RSP Token management */

import { toRequestUrl } from './rspProxy.js';

const TOKEN_KEY = 'rubin_rsp_token';

export interface AuthState {
  token: string | null;
  authenticated: boolean;
  expiresAt: number | null;
}

let authState: AuthState = {
  token: null,
  authenticated: false,
  expiresAt: null,
};

/**
 * Store the RSP token. By default it lives in `sessionStorage` (cleared when the
 * tab closes). Pass `persist = true` to keep it in `localStorage` so it survives
 * across sessions on this device — an explicit, opt-in trade-off (a bearer token
 * on disk is a security consideration; only for a trusted personal machine).
 */
export function setToken(token: string, persist = false): void {
  authState = {
    token,
    authenticated: true,
    expiresAt: parseTokenExpiry(token),
  };
  if (persist) {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getToken(): string | null {
  if (authState.token) return authState.token;
  const persisted = localStorage.getItem(TOKEN_KEY);
  const stored = sessionStorage.getItem(TOKEN_KEY) ?? persisted;
  if (stored) {
    // Rehydrate in-memory state without moving the token between storages.
    setToken(stored, persisted !== null);
    return stored;
  }
  return null;
}

/** Whether the current token is persisted to localStorage (survives tab close). */
export function isTokenPersisted(): boolean {
  return localStorage.getItem(TOKEN_KEY) !== null;
}

export function clearToken(): void {
  authState = { token: null, authenticated: false, expiresAt: null };
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  if (authState.expiresAt && Date.now() > authState.expiresAt) {
    clearToken();
    return false;
  }
  return true;
}

export function getAuthHeader(): Record<string, string> {
  const token = getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * The current token's expiry in epoch milliseconds, or `null` when it is unknown.
 *
 * RSP user tokens are OPAQUE Gafaelfawr handles (`gt-…`), not JWTs, so their expiry
 * cannot be decoded client-side and is honestly reported as `null` — never a
 * fabricated value. A real expiry is only surfaced by a 401 from the service.
 */
export function getTokenExpiry(): number | null {
  getToken(); // rehydrate authState from storage if the token isn't in memory
  return authState.expiresAt;
}

/**
 * Validate the token's IDENTITY against the RSP auth service.
 *
 * Uses Gafaelfawr's user-info endpoint, which returns 200 for any valid token
 * and 401 for an invalid/expired one — independent of DP1 *data rights*. (The
 * old check ran a DP0.2 TAP query against a DP1 endpoint, so it failed even for
 * valid tokens and conflated "authenticated" with "has data access".)
 */
export async function validateToken(token: string): Promise<boolean> {
  try {
    const resp = await fetch(toRequestUrl('https://data.lsst.cloud/auth/api/v1/user-info'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * True for an opaque Gafaelfawr RSP token (`gt-…`). These are the tokens the RSP
 * actually issues: random handles, NOT JWTs, with no client-decodable payload.
 */
function isOpaqueRspToken(token: string): boolean {
  return token.startsWith('gt-');
}

/**
 * Best-effort token expiry in epoch milliseconds, or `null` when unknown.
 *
 * RSP user tokens are opaque `gt-…` handles with nothing to decode, so we do NOT
 * try to JWT-parse them and do NOT fabricate an expiry — we return `null`
 * (expiry unknown; a 401 from the service is the real end-of-life signal). Only a
 * genuinely JWT-shaped token (three dot-separated segments) is decoded, as a
 * convenience for deployments that mint JWTs.
 */
function parseTokenExpiry(token: string): number | null {
  // Opaque RSP token: no client-side expiry exists — report unknown, don't invent one.
  if (isOpaqueRspToken(token)) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null; // not a JWT — nothing to decode
  try {
    const payload = JSON.parse(atob(parts[1]!)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
