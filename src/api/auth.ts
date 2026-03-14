/** RSP Token management */

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

export function setToken(token: string): void {
  authState = {
    token,
    authenticated: true,
    expiresAt: parseTokenExpiry(token),
  };
  // Store in session only (not localStorage)
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  if (authState.token) return authState.token;
  const stored = sessionStorage.getItem(TOKEN_KEY);
  if (stored) {
    setToken(stored);
    return stored;
  }
  return null;
}

export function clearToken(): void {
  authState = { token: null, authenticated: false, expiresAt: null };
  sessionStorage.removeItem(TOKEN_KEY);
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

/** Validate token by making a test API call */
export async function validateToken(token: string): Promise<boolean> {
  try {
    const resp = await fetch('https://data.lsst.cloud/api/dp1/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${token}`,
      },
      body: 'QUERY=SELECT+TOP+1+*+FROM+dp02_dc2_catalogs.Object&LANG=ADQL&FORMAT=json',
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Attempt to parse expiry from JWT token */
function parseTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
