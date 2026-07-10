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

// DP1 HiPS lives under /api/hips/v2/dp1/deep_coadd/… (the old DP0.2 path
// /api/hips/images/color_gri 404s against DP1 and silently degraded authenticated
// users to DSS). Every DP1 dataset is PNG at hips_order 11. Datasets verified from
// the public list endpoint: https://data.lsst.cloud/api/hips/v2/dp1/list
export const RUBIN_HIPS_ROOT = 'https://data.lsst.cloud/api/hips/v2/dp1/deep_coadd';

/** A selectable Rubin DP1 HiPS dataset (colour composite or single band). */
export interface RubinDataset {
  /** Path segment under {@link RUBIN_HIPS_ROOT}, e.g. `color_gri` or `band_r`. */
  id: string;
  /** Short label for the filter/dataset selector. */
  label: string;
  kind: 'color' | 'band';
}

/** The DP1 datasets the viewer offers as a multi-filter switch. */
export const RUBIN_DATASETS: readonly RubinDataset[] = [
  { id: 'color_gri', label: 'gri colour', kind: 'color' },
  { id: 'color_ugri', label: 'ugri colour', kind: 'color' },
  { id: 'color_riz', label: 'riz colour', kind: 'color' },
  { id: 'color_izy', label: 'izy colour', kind: 'color' },
  { id: 'color_ugr', label: 'ugr colour', kind: 'color' },
  { id: 'band_u', label: 'u', kind: 'band' },
  { id: 'band_g', label: 'g', kind: 'band' },
  { id: 'band_r', label: 'r', kind: 'band' },
  { id: 'band_i', label: 'i', kind: 'band' },
  { id: 'band_z', label: 'z', kind: 'band' },
  { id: 'band_y', label: 'y', kind: 'band' },
];

/** The default Rubin dataset id. */
export const RUBIN_DEFAULT_DATASET = 'color_gri';

/** Full HiPS base URL for a Rubin DP1 dataset id. */
export function rubinDatasetUrl(datasetId: string): string {
  return `${RUBIN_HIPS_ROOT}/${datasetId}`;
}

/** The default Rubin base (gri colour), kept for callers/tests that want one URL. */
export const RUBIN_HIPS = rubinDatasetUrl(RUBIN_DEFAULT_DATASET);

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
export function resolveActiveBaseUrl(
  mode: BaseMode,
  hasToken: boolean,
  fellBack: boolean,
  rubinDatasetId: string = RUBIN_DEFAULT_DATASET,
): string {
  const rubin = rubinDatasetUrl(rubinDatasetId);
  if (mode === 'offline') return OFFLINE_HIPS;
  if (mode === 'dss') return PUBLIC_HIPS;
  if (mode === 'rubin') return rubin;
  if (!hasToken || fellBack) return PUBLIC_HIPS;
  return rubin;
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
  if (!isRubinUrl(url)) return 'DSS2 Color';
  // Name the specific DP1 dataset, e.g. "Rubin gri colour" / "Rubin r".
  const ds = RUBIN_DATASETS.find((d) => url.endsWith(`/${d.id}`));
  return ds ? `Rubin ${ds.label}` : 'Rubin DP1';
}
