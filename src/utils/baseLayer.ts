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

import { getAuthHeader } from '../api/auth.js';
import { toRequestUrl } from '../api/rspProxy.js';

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

// --- DP1 dataset discovery ------------------------------------------------
//
// The datasets above are the hardcoded FALLBACK. The live set is discovered at
// runtime from the DP1 HiPS list endpoint. Probed 2026-07-11 from
// http://localhost:5173 origin:
//   GET https://data.lsst.cloud/api/hips/v2/dp1/list
//   → 200, content-type: text/plain, NO Access-Control-Allow-Origin header.
// Because the RSP host sends no ACAO, a browser fetch is CORS-blocked, so the
// request MUST go through the dev `/rsp` proxy via toRequestUrl() (same as every
// other Rubin request). The body is a HiPS multi-record "properties" list: one
// blank-line-separated block per dataset, each a set of `key = value` lines,
// including e.g.:
//   creator_did       = ivo://org.rubinobs/lsst-dp1?hips=color_gri&type=deep_coadd
//   hips_service_url   = https://data.lsst.cloud/api/hips/v2/dp1/deep_coadd/color_gri
//   dataproduct_subtype = color   (NOTE: this is "color" even for single BANDS —
//                                   kind must come from the id prefix, not this)
// The live list returned exactly the 11 datasets hardcoded above (5 colour
// composites + 6 ugrizy bands). See tests/fixtures/dp1-hips-list.txt.

/** The public DP1 HiPS list endpoint (absolute; rewritten by toRequestUrl in dev). */
export const RUBIN_DP1_LIST_URL = 'https://data.lsst.cloud/api/hips/v2/dp1/list';

/** Derive the short selector label for a dataset id (matches RUBIN_DATASETS). */
function datasetLabel(id: string, kind: 'color' | 'band'): string {
  return kind === 'color' ? `${id.slice('color_'.length)} colour` : id.slice('band_'.length);
}

/** Extract the dataset id (e.g. `color_gri`, `band_r`) from one parsed record. */
function datasetIdFromRecord(props: Map<string, string>): string | null {
  // Prefer the service URL's last path segment — it is exactly the id.
  const url = props.get('hips_service_url');
  if (url) {
    const seg = url.split(/[?#]/)[0]!.split('/').filter(Boolean).pop();
    if (seg) return seg;
  }
  // Fallback: the `hips=<id>` query param of the creator_did IVOA identifier.
  const did = props.get('creator_did');
  const m = did?.match(/[?&]hips=([^&]+)/);
  return m ? m[1]! : null;
}

/**
 * Parse the DP1 HiPS `…/list` body (a HiPS multi-record properties list) into the
 * same typed shape as {@link RUBIN_DATASETS}. Pure and total: blocks are split on
 * blank lines; each block's `key = value` lines are read; the dataset id comes
 * from `hips_service_url` (or the `creator_did` `hips=` param); `kind` is derived
 * from the id prefix (`color_`/`band_`), since `dataproduct_subtype` is "color"
 * even for grayscale bands. Records without a recognisable colour/band id are
 * skipped, and duplicate ids are kept once. Malformed / empty input yields `[]`.
 */
export function parseDp1DatasetList(text: string): RubinDataset[] {
  const datasets: RubinDataset[] = [];
  const seen = new Set<string>();
  for (const block of text.split(/\n[ \t]*\n/)) {
    const props = new Map<string, string>();
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      props.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
    }
    const id = datasetIdFromRecord(props);
    if (!id || seen.has(id)) continue;
    const kind: 'color' | 'band' | null = id.startsWith('color_')
      ? 'color'
      : id.startsWith('band_')
        ? 'band'
        : null;
    if (!kind) continue;
    seen.add(id);
    datasets.push({ id, label: datasetLabel(id, kind), kind });
  }
  return datasets;
}

/**
 * Discover the available DP1 HiPS datasets at runtime from the list endpoint,
 * falling back to the hardcoded {@link RUBIN_DATASETS} on ANY failure (network,
 * CORS, non-2xx, or a body that parses to nothing) so the Filter dropdown is
 * NEVER empty and the app never breaks. Routed through toRequestUrl() so it works
 * behind the dev `/rsp` proxy (the endpoint sends no CORS header).
 *
 * `fetchImpl` is injectable for unit testing; it defaults to the global fetch.
 */
export async function fetchDp1Datasets(
  fetchImpl: typeof fetch = fetch,
): Promise<readonly RubinDataset[]> {
  try {
    const resp = await fetchImpl(toRequestUrl(RUBIN_DP1_LIST_URL), {
      headers: getAuthHeader(),
    });
    if (!resp.ok) return RUBIN_DATASETS;
    const parsed = parseDp1DatasetList(await resp.text());
    return parsed.length > 0 ? parsed : RUBIN_DATASETS;
  } catch {
    // Network error / CORS / abort / non-text body — degrade to the hardcoded list.
    return RUBIN_DATASETS;
  }
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
