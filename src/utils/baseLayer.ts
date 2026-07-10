/**
 * Base-layer resolution — the single source of truth for which HiPS survey the
 * viewer draws, given the user's Base selection, whether a token is present, and
 * whether an automatic fallback has occurred.
 *
 * Kept as a pure function (not inlined in ImageViewer) so the full truth table
 * is unit-testable — see tests/unit/baseLayer.test.ts. The "auto degraded to
 * DSS silently" bug happened because this logic was an inline $derived that
 * couldn't distinguish an explicit Rubin choice from auto-resolved-Rubin.
 */

export const PUBLIC_HIPS = 'https://alasky.cds.unistra.fr/DSS/DSSColor';
// DP1 gri colour coadd HiPS. NOTE: DP1 lives under /api/hips/v2/dp1/deep_coadd/…;
// the old DP0.2 path (/api/hips/images/color_gri) 404s against a DP1 deployment,
// which silently degraded authenticated users to DSS. See the Rubin HiPS `list`
// endpoint: https://data.lsst.cloud/api/hips/v2/dp1/list
export const RUBIN_HIPS = 'https://data.lsst.cloud/api/hips/v2/dp1/deep_coadd/color_gri';
/** Sentinel "URL" for the in-app offline synthetic dataset (never fetched). */
export const OFFLINE_HIPS = 'offline://synthetic';

export type BaseMode = 'auto' | 'dss' | 'rubin' | 'offline';

/**
 * Resolve the active base HiPS URL.
 * - `dss`  → always public DSS (even while holding a token).
 * - `rubin`→ always Rubin (even with no token — the user asked for it explicitly;
 *            failures surface as an error telling them to switch, NOT a silent
 *            fallback).
 * - `auto` → Rubin when a token is present AND we haven't fallen back; otherwise
 *            public DSS. This is what makes "Auto" degrade to DSS without user
 *            action when Rubin is unavailable.
 */
export function resolveActiveBaseUrl(mode: BaseMode, hasToken: boolean, fellBack: boolean): string {
  if (mode === 'offline') return OFFLINE_HIPS;
  if (mode === 'dss') return PUBLIC_HIPS;
  if (mode === 'rubin') return RUBIN_HIPS;
  if (!hasToken || fellBack) return PUBLIC_HIPS;
  return RUBIN_HIPS;
}

/** Whether a resolved base URL points at the authenticated Rubin service. */
export function isRubinUrl(url: string): boolean {
  return url.includes('data.lsst.cloud');
}

/** Whether a resolved base URL is the in-app offline synthetic dataset. */
export function isOfflineUrl(url: string): boolean {
  return url === OFFLINE_HIPS;
}

/** The label shown for the resolved base layer (for the active-layers indicator). */
export function activeBaseLabel(url: string): string {
  if (isOfflineUrl(url)) return 'Offline demo';
  return isRubinUrl(url) ? 'Rubin color_gri' : 'DSS2 Color';
}
