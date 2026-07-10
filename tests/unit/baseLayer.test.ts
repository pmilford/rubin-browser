import { describe, it, expect } from 'vitest';
import {
  resolveActiveBaseUrl,
  isRubinUrl,
  isOfflineUrl,
  activeBaseLabel,
  PUBLIC_HIPS,
  RUBIN_HIPS,
  OFFLINE_HIPS,
} from '../../src/utils/baseLayer.js';

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

describe('isRubinUrl / activeBaseLabel', () => {
  it('detects the Rubin host', () => {
    expect(isRubinUrl(RUBIN_HIPS)).toBe(true);
    expect(isRubinUrl(PUBLIC_HIPS)).toBe(false);
  });
  it('labels the resolved base', () => {
    expect(activeBaseLabel(RUBIN_HIPS)).toBe('Rubin color_gri');
    expect(activeBaseLabel(PUBLIC_HIPS)).toBe('DSS2 Color');
  });
});
