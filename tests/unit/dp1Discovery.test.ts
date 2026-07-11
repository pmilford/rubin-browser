/**
 * TODO 129 — DP1 dataset discovery: parser + fetch-fallback unit tests.
 *
 * These are PURE-logic tests (parsing + failure→fallback). They cannot prove the
 * dropdown renders or that the real endpoint is reachable/CORS-OK — that is the
 * job of tests/ui/dp1-discovery.spec.ts and base-fallback.spec.ts. Here we only
 * assert that:
 *   1. The parser, fed the VERBATIM real `/api/hips/v2/dp1/list` body (committed
 *      at tests/fixtures/dp1-hips-list.txt), yields exactly the 11 datasets with
 *      the correct ids/labels/kinds — a parser that drops datasets or returns []
 *      on the happy path FAILS here.
 *   2. On any failure (non-2xx, network throw, empty/garbage body) fetchDp1Datasets
 *      returns the hardcoded fallback — asserted to EQUAL RUBIN_DATASETS, never [].
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  parseDp1DatasetList,
  fetchDp1Datasets,
  RUBIN_DATASETS,
  RUBIN_DP1_LIST_URL,
  type RubinDataset,
} from '../../src/utils/baseLayer.js';

// The verbatim body captured from the live public endpoint on 2026-07-11.
const REAL_LIST = readFileSync(resolve(process.cwd(), 'tests/fixtures/dp1-hips-list.txt'), 'utf8');

const key = (d: RubinDataset): string => `${d.id}|${d.label}|${d.kind}`;
const okResponse = (body: string): Response =>
  ({ ok: true, status: 200, text: () => Promise.resolve(body) }) as unknown as Response;

describe('parseDp1DatasetList (real endpoint body)', () => {
  it('parses the 11 real DP1 datasets with correct ids/labels/kinds', () => {
    const parsed = parseDp1DatasetList(REAL_LIST);
    // The live list carries 5 colour composites + 6 ugrizy bands.
    expect(parsed).toHaveLength(11);
    expect(parsed.filter((d) => d.kind === 'color')).toHaveLength(5);
    expect(parsed.filter((d) => d.kind === 'band')).toHaveLength(6);

    // Same SET (ids/labels/kinds) as the hardcoded fallback — order may differ
    // because it mirrors the endpoint's ordering, so compare as sets.
    expect(new Set(parsed.map(key))).toEqual(new Set(RUBIN_DATASETS.map(key)));

    // Spot-check the derived shape is exactly right (not just "some string").
    expect(parsed.find((d) => d.id === 'color_gri')).toEqual({
      id: 'color_gri',
      label: 'gri colour',
      kind: 'color',
    });
    expect(parsed.find((d) => d.id === 'band_r')).toEqual({
      id: 'band_r',
      label: 'r',
      kind: 'band',
    });
    // A band record's dataproduct_subtype is literally "color" in the real body,
    // so kind MUST come from the id prefix — assert bands are typed 'band'.
    expect(parsed.find((d) => d.id === 'band_y')?.kind).toBe('band');
  });

  it('derives id from creator_did when hips_service_url is absent', () => {
    const block = [
      'creator_did = ivo://org.rubinobs/lsst-dp1?hips=color_riz&type=deep_coadd',
      'obs_title   = LSSTComCam: DP1 riz',
    ].join('\n');
    expect(parseDp1DatasetList(block)).toEqual([
      { id: 'color_riz', label: 'riz colour', kind: 'color' },
    ]);
  });

  it('skips records without a recognisable colour/band id and dedups', () => {
    const body = [
      'hips_service_url = https://data.lsst.cloud/api/hips/v2/dp1/deep_coadd/color_gri',
      '',
      'hips_service_url = https://example/some/other_product', // unknown prefix → skipped
      '',
      'hips_service_url = https://data.lsst.cloud/api/hips/v2/dp1/deep_coadd/color_gri', // dup
    ].join('\n');
    expect(parseDp1DatasetList(body)).toEqual([
      { id: 'color_gri', label: 'gri colour', kind: 'color' },
    ]);
  });

  it('returns [] for empty / malformed input', () => {
    expect(parseDp1DatasetList('')).toEqual([]);
    expect(parseDp1DatasetList('not a properties file at all\n{"json":true}')).toEqual([]);
  });
});

describe('fetchDp1Datasets', () => {
  it('returns the parsed discovered datasets on a successful fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(REAL_LIST));
    const result = await fetchDp1Datasets(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // It hit the DP1 list URL (possibly proxy-rewritten in dev — assert the path).
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/api/hips/v2/dp1/list');
    expect(new Set(result.map(key))).toEqual(new Set(RUBIN_DATASETS.map(key)));
  });

  it('falls back to RUBIN_DATASETS on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('nope') });
    const result = await fetchDp1Datasets(fetchImpl as unknown as typeof fetch);
    expect(result).toEqual(RUBIN_DATASETS);
    expect(result.length).toBeGreaterThan(0);
  });

  it('falls back to RUBIN_DATASETS on a network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    const result = await fetchDp1Datasets(fetchImpl as unknown as typeof fetch);
    expect(result).toEqual(RUBIN_DATASETS);
  });

  it('falls back to RUBIN_DATASETS on an empty / unparseable body (never empty)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('   \n\n<html>portal</html>\n'));
    const result = await fetchDp1Datasets(fetchImpl as unknown as typeof fetch);
    expect(result).toEqual(RUBIN_DATASETS);
    expect(result).not.toEqual([]);
  });

  it('targets the canonical public list endpoint', () => {
    expect(RUBIN_DP1_LIST_URL).toBe('https://data.lsst.cloud/api/hips/v2/dp1/list');
  });
});
