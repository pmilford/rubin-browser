import { describe, it, expect } from 'vitest';
import {
  LSST_FILTERS,
  FILTER_BANDS,
  getFilterInfo,
  SURVEY_OVERLAYS,
  getSurveyInfo,
  generateMockEpochs,
  DEFAULT_MOCK_EPOCHS,
} from '../../src/constants.js';

describe('constants', () => {
  describe('LSST_FILTERS', () => {
    it('defines all 6 LSST filters', () => {
      expect(LSST_FILTERS).toHaveLength(6);
    });

    it('has u, g, r, i, z, y in order', () => {
      const names = LSST_FILTERS.map(f => f.name);
      expect(names).toEqual(['u', 'g', 'r', 'i', 'z', 'y']);
    });

    it('has increasing wavelengths', () => {
      const wavelengths = LSST_FILTERS.map(f => f.wavelength);
      for (let i = 1; i < wavelengths.length; i++) {
        expect(wavelengths[i]).toBeGreaterThan(wavelengths[i - 1]!);
      }
    });

    it('has valid hex colors', () => {
      for (const filter of LSST_FILTERS) {
        expect(filter.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it('has descriptions', () => {
      for (const filter of LSST_FILTERS) {
        expect(filter.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('FILTER_BANDS', () => {
    it('has 6 bands', () => {
      expect(FILTER_BANDS).toHaveLength(6);
    });

    it('matches filter names', () => {
      const names = LSST_FILTERS.map(f => f.name);
      expect([...FILTER_BANDS]).toEqual(names);
    });
  });

  describe('getFilterInfo', () => {
    it('returns filter info for valid band', () => {
      const info = getFilterInfo('g');
      expect(info).toBeDefined();
      expect(info?.name).toBe('g');
      expect(info?.wavelength).toBe(482);
    });

    it('returns undefined for invalid band', () => {
      expect(getFilterInfo('X')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getFilterInfo('')).toBeUndefined();
    });
  });

  describe('SURVEY_OVERLAYS', () => {
    it('defines 5 surveys', () => {
      expect(SURVEY_OVERLAYS).toHaveLength(5);
    });

    it('has Gaia DR3', () => {
      const gaia = SURVEY_OVERLAYS.find(s => s.id === 'gaia-dr3');
      expect(gaia).toBeDefined();
      expect(gaia?.hipsUrl).toContain('gaia');
    });

    it('has DSS2 Color', () => {
      const dss = SURVEY_OVERLAYS.find(s => s.id === 'dss2-color');
      expect(dss).toBeDefined();
      expect(dss?.hipsUrl).toContain('DSS');
    });

    it('has 2MASS J', () => {
      const tmass = SURVEY_OVERLAYS.find(s => s.id === '2mass-j');
      expect(tmass).toBeDefined();
      expect(tmass?.hipsUrl).toContain('2MASS');
    });

    it('has SDSS Color', () => {
      const sdss = SURVEY_OVERLAYS.find(s => s.id === 'sdss-color');
      expect(sdss).toBeDefined();
      expect(sdss?.hipsUrl).toContain('SDSS');
    });

    it('has PanSTARRS DR1', () => {
      const ps = SURVEY_OVERLAYS.find(s => s.id === 'panstarrs-dr1');
      expect(ps).toBeDefined();
      expect(ps?.hipsUrl).toContain('Pan-STARRS');
    });

    it('all surveys have valid URLs', () => {
      for (const survey of SURVEY_OVERLAYS) {
        expect(survey.hipsUrl).toMatch(/^https?:\/\//);
      }
    });
  });

  describe('getSurveyInfo', () => {
    it('returns survey info for valid ID', () => {
      const info = getSurveyInfo('gaia-dr3');
      expect(info).toBeDefined();
      expect(info?.name).toBe('Gaia DR3');
    });

    it('returns undefined for invalid ID', () => {
      expect(getSurveyInfo('nonexistent')).toBeUndefined();
    });
  });

  describe('generateMockEpochs', () => {
    it('generates requested number of epochs', () => {
      const epochs = generateMockEpochs(15);
      expect(epochs).toHaveLength(15);
    });

    it('generates 30 epochs by default', () => {
      const epochs = generateMockEpochs();
      expect(epochs).toHaveLength(30);
    });

    it('generates epochs sorted by MJD', () => {
      const epochs = generateMockEpochs(20);
      for (let i = 1; i < epochs.length; i++) {
        expect(epochs[i]!.mjd).toBeGreaterThanOrEqual(epochs[i - 1]!.mjd);
      }
    });

    it('assigns filters from g, r, i', () => {
      const epochs = generateMockEpochs(10);
      const validFilters = new Set(['g', 'r', 'i']);
      for (const epoch of epochs) {
        expect(validFilters.has(epoch.filter)).toBe(true);
      }
    });

    it('generates MJD values in reasonable range', () => {
      const epochs = generateMockEpochs(10);
      for (const epoch of epochs) {
        expect(epoch.mjd).toBeGreaterThan(59900);
        expect(epoch.mjd).toBeLessThan(61000);
      }
    });
  });

  describe('DEFAULT_MOCK_EPOCHS', () => {
    it('has 30 entries', () => {
      expect(DEFAULT_MOCK_EPOCHS).toHaveLength(30);
    });

    it('is sorted', () => {
      for (let i = 1; i < DEFAULT_MOCK_EPOCHS.length; i++) {
        expect(DEFAULT_MOCK_EPOCHS[i]!.mjd).toBeGreaterThanOrEqual(
          DEFAULT_MOCK_EPOCHS[i - 1]!.mjd
        );
      }
    });
  });
});
