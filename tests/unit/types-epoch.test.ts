import { describe, it, expect } from 'vitest';
import {
  isEpoch,
  mjdToIso,
  isoToMjd,
} from '../../src/types/image.js';

describe('Epoch type', () => {
  describe('isEpoch', () => {
    it('returns true for valid epoch', () => {
      expect(isEpoch({ mjd: 60000, isoDate: '2023-04-01' })).toBe(true);
    });

    it('returns true for epoch with optional fields', () => {
      expect(isEpoch({
        mjd: 60000,
        isoDate: '2023-04-01',
        filter: 'r',
        exposureId: 'exp-123',
      })).toBe(true);
    });

    it('returns false for null', () => {
      expect(isEpoch(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isEpoch(undefined)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isEpoch(42)).toBe(false);
      expect(isEpoch('string')).toBe(false);
    });

    it('returns false for missing mjd', () => {
      expect(isEpoch({ isoDate: '2023-04-01' })).toBe(false);
    });

    it('returns false for missing isoDate', () => {
      expect(isEpoch({ mjd: 60000 })).toBe(false);
    });

    it('returns false for wrong mjd type', () => {
      expect(isEpoch({ mjd: '60000', isoDate: '2023-04-01' })).toBe(false);
    });

    it('returns false for wrong isoDate type', () => {
      expect(isEpoch({ mjd: 60000, isoDate: 123 })).toBe(false);
    });

    it('returns false for wrong filter type', () => {
      expect(isEpoch({ mjd: 60000, isoDate: '2023-04-01', filter: 42 })).toBe(false);
    });

    it('returns false for wrong exposureId type', () => {
      expect(isEpoch({ mjd: 60000, isoDate: '2023-04-01', exposureId: 42 })).toBe(false);
    });
  });

  describe('mjdToIso', () => {
    it('converts MJD 0 to correct date', () => {
      // MJD 0 = November 17, 1858
      const result = mjdToIso(0);
      expect(result).toBe('1858-11-17');
    });

    it('converts MJD 60000 to correct date', () => {
      const result = mjdToIso(60000);
      expect(result).toBe('2023-02-25');
    });

    it('converts MJD 40587 to 1970-01-01', () => {
      const result = mjdToIso(40587);
      expect(result).toBe('1970-01-01');
    });
  });

  describe('isoToMjd', () => {
    it('converts 1970-01-01 to MJD 40587', () => {
      const result = isoToMjd('1970-01-01');
      expect(result).toBeCloseTo(40587, 0);
    });

    it('round-trips with mjdToIso', () => {
      const mjd = 60000;
      const iso = mjdToIso(mjd);
      const result = isoToMjd(iso);
      expect(result).toBeCloseTo(mjd, 0);
    });
  });
});
