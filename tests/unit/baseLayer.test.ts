import { describe, it, expect } from 'vitest';
import {
  resolveActiveBaseUrl,
  isRubinUrl,
  isOfflineUrl,
  activeBaseLabel,
  rubinDatasetUrl,
  RUBIN_DATASETS,
  PUBLIC_HIPS,
  RUBIN_HIPS,
  OFFLINE_HIPS,
} from '../../src/utils/baseLayer.js';

describe('Rubin DP1 dataset switching (multi-filter)', () => {
  it('builds each dataset URL under the DP1 deep_coadd path', () => {
    for (const d of RUBIN_DATASETS) {
      const url = rubinDatasetUrl(d.id);
      expect(url).toBe(`https://data.lsst.cloud/api/hips/v2/dp1/deep_coadd/${d.id}`);
      expect(isRubinUrl(url)).toBe(true);
      expect(url).not.toContain('/api/hips/images/');
    }
  });

  it('offers the 6 ugrizy bands plus colour composites', () => {
    const bands = RUBIN_DATASETS.filter((d) => d.kind === 'band').map((d) => d.id);
    expect(bands).toEqual(['band_u', 'band_g', 'band_r', 'band_i', 'band_z', 'band_y']);
    expect(RUBIN_DATASETS.some((d) => d.id === 'color_gri' && d.kind === 'color')).toBe(true);
  });

  it('resolveActiveBaseUrl honours the selected dataset for rubin AND auto', () => {
    expect(resolveActiveBaseUrl('rubin', true, false, 'band_r')).toBe(rubinDatasetUrl('band_r'));
    expect(resolveActiveBaseUrl('auto', true, false, 'band_g')).toBe(rubinDatasetUrl('band_g'));
    // Auto that has fallen back stays on DSS regardless of dataset.
    expect(resolveActiveBaseUrl('auto', true, true, 'band_r')).toBe(PUBLIC_HIPS);
    // Default dataset is gri colour.
    expect(resolveActiveBaseUrl('rubin', true, false)).toBe(RUBIN_HIPS);
  });

  it('labels each dataset distinctly', () => {
    expect(activeBaseLabel(rubinDatasetUrl('band_r'))).toBe('Rubin r');
    expect(activeBaseLabel(rubinDatasetUrl('color_izy'))).toBe('Rubin izy colour');
  });
});

describe('resolveActiveBaseUrl — full truth table', () => {
  it('auto + token + not-fallen-back → Rubin', () => {
    expect(resolveActiveBaseUrl('auto', true, false)).toBe(RUBIN_HIPS);
  });
  it('auto + token + fallen-back → DSS (this is the silent-fallback fix)', () => {
    expect(resolveActiveBaseUrl('auto', true, true)).toBe(PUBLIC_HIPS);
  });
  it('auto + no token → DSS regardless of fallback flag', () => {
    expect(resolveActiveBaseUrl('auto', false, false)).toBe(PUBLIC_HIPS);
    expect(resolveActiveBaseUrl('auto', false, true)).toBe(PUBLIC_HIPS);
  });
  it('explicit dss → DSS even with a token', () => {
    expect(resolveActiveBaseUrl('dss', true, false)).toBe(PUBLIC_HIPS);
  });
  it('explicit rubin → Rubin even with NO token and even if a stale fellBack is set', () => {
    expect(resolveActiveBaseUrl('rubin', false, false)).toBe(RUBIN_HIPS);
    expect(resolveActiveBaseUrl('rubin', true, true)).toBe(RUBIN_HIPS);
  });
  it('offline → the synthetic sentinel regardless of token/fallback', () => {
    expect(resolveActiveBaseUrl('offline', false, false)).toBe(OFFLINE_HIPS);
    expect(resolveActiveBaseUrl('offline', true, true)).toBe(OFFLINE_HIPS);
  });
});

describe('isOfflineUrl / offline label', () => {
  it('detects the offline sentinel and nothing else', () => {
    expect(isOfflineUrl(OFFLINE_HIPS)).toBe(true);
    expect(isOfflineUrl(RUBIN_HIPS)).toBe(false);
    expect(isOfflineUrl(PUBLIC_HIPS)).toBe(false);
    expect(isRubinUrl(OFFLINE_HIPS)).toBe(false);
  });
  it('labels the offline base', () => {
    expect(activeBaseLabel(OFFLINE_HIPS)).toBe('Offline demo');
  });
});

describe('RUBIN_HIPS points at the DP1 HiPS path (not retired DP0.2)', () => {
  it('uses the /api/hips/v2/dp1/deep_coadd/ path and NOT /api/hips/images/', () => {
    // Ground truth from the live Rubin HiPS list: DP1 gri coadd lives here.
    expect(RUBIN_HIPS).toBe('https://data.lsst.cloud/api/hips/v2/dp1/deep_coadd/color_gri');
    // The retired DP0.2 path 404s against DP1 and silently degraded to DSS.
    expect(RUBIN_HIPS).not.toContain('/api/hips/images/');
    expect(isRubinUrl(RUBIN_HIPS)).toBe(true);
  });
});

describe('isRubinUrl / activeBaseLabel', () => {
  it('detects the Rubin host', () => {
    expect(isRubinUrl(RUBIN_HIPS)).toBe(true);
    expect(isRubinUrl(PUBLIC_HIPS)).toBe(false);
  });
  it('labels the resolved base (naming the specific DP1 dataset)', () => {
    expect(activeBaseLabel(RUBIN_HIPS)).toBe('Rubin gri colour');
    expect(activeBaseLabel(PUBLIC_HIPS)).toBe('DSS2 Color');
  });
});
