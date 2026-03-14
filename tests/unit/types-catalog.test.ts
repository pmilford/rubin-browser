import { describe, it, expect } from 'vitest';
import {
  isCoordinates,
  isPhotometry,
  isCatalogObject,
  isLightCurvePoint,
  isTapQueryResult,
  isConeSearchParams,
  isValidCatalogName,
} from '../../src/types/catalog.js';
import type {
  Coordinates,
  Photometry,
  CatalogObject,
  LightCurvePoint,
  TapQueryResult,
  ConeSearchParams,
} from '../../src/types/catalog.js';

describe('isCoordinates', () => {
  it('accepts valid coordinates', () => {
    expect(isCoordinates({ ra: 62.0, dec: -37.0 })).toBe(true);
  });

  it('accepts zero coordinates', () => {
    expect(isCoordinates({ ra: 0, dec: 0 })).toBe(true);
  });

  it('rejects null', () => {
    expect(isCoordinates(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isCoordinates(undefined)).toBe(false);
  });

  it('rejects a string', () => {
    expect(isCoordinates('62, -37')).toBe(false);
  });

  it('rejects an array', () => {
    expect(isCoordinates([62, -37])).toBe(false);
  });

  it('rejects missing ra', () => {
    expect(isCoordinates({ dec: -37 })).toBe(false);
  });

  it('rejects missing dec', () => {
    expect(isCoordinates({ ra: 62 })).toBe(false);
  });

  it('rejects string ra', () => {
    expect(isCoordinates({ ra: '62', dec: -37 })).toBe(false);
  });

  it('rejects empty object', () => {
    expect(isCoordinates({})).toBe(false);
  });
});

describe('isPhotometry', () => {
  const validPhotometry: Photometry = { u: 22.1, g: 21.5, r: 20.8, i: 20.3, z: 19.9, y: 19.7 };

  it('accepts valid photometry with all bands', () => {
    expect(isPhotometry(validPhotometry)).toBe(true);
  });

  it('accepts photometry with null bands', () => {
    expect(isPhotometry({ u: null, g: null, r: null, i: null, z: null, y: null })).toBe(true);
  });

  it('accepts photometry with mixed null and number bands', () => {
    expect(isPhotometry({ u: 22.1, g: null, r: 20.8, i: null, z: 19.9, y: null })).toBe(true);
  });

  it('rejects null', () => {
    expect(isPhotometry(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isPhotometry(undefined)).toBe(false);
  });

  it('rejects string value in band', () => {
    expect(isPhotometry({ u: '22.1', g: 21.5, r: 20.8, i: 20.3, z: 19.9, y: 19.7 })).toBe(false);
  });

  it('rejects missing band', () => {
    expect(isPhotometry({ u: 22.1, g: 21.5, r: 20.8, i: 20.3, z: 19.9 })).toBe(false);
  });

  it('rejects empty object', () => {
    expect(isPhotometry({})).toBe(false);
  });
});

describe('isCatalogObject', () => {
  const validObject: CatalogObject = {
    objectId: '123456789',
    coordinates: { ra: 62.0, dec: -37.0 },
    photometry: { u: 22.1, g: 21.5, r: 20.8, i: 20.3, z: 19.9, y: 19.7 },
    extendedness: 0.2,
    redshift: 0.5,
    classification: 'galaxy',
  };

  it('accepts valid catalog object', () => {
    expect(isCatalogObject(validObject)).toBe(true);
  });

  it('accepts object with null optional fields', () => {
    expect(isCatalogObject({
      ...validObject,
      extendedness: null,
      redshift: null,
      classification: null,
    })).toBe(true);
  });

  it('rejects null', () => {
    expect(isCatalogObject(null)).toBe(false);
  });

  it('rejects object with invalid coordinates', () => {
    expect(isCatalogObject({ ...validObject, coordinates: 'invalid' })).toBe(false);
  });

  it('rejects object with invalid photometry', () => {
    expect(isCatalogObject({ ...validObject, photometry: 'invalid' })).toBe(false);
  });

  it('rejects object with non-string objectId', () => {
    expect(isCatalogObject({ ...validObject, objectId: 123 })).toBe(false);
  });

  it('rejects object with wrong extendedness type', () => {
    expect(isCatalogObject({ ...validObject, extendedness: '0.2' })).toBe(false);
  });

  it('rejects object with wrong classification type', () => {
    expect(isCatalogObject({ ...validObject, classification: 42 })).toBe(false);
  });
});

describe('isLightCurvePoint', () => {
  const validPoint: LightCurvePoint = {
    mjd: 60000.5,
    magnitude: 21.5,
    magnitudeErr: 0.1,
    filter: 'r',
    exposureId: 'exp-001',
  };

  it('accepts valid light curve point', () => {
    expect(isLightCurvePoint(validPoint)).toBe(true);
  });

  it('rejects null', () => {
    expect(isLightCurvePoint(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isLightCurvePoint(undefined)).toBe(false);
  });

  it('rejects missing magnitude', () => {
    expect(isLightCurvePoint({ mjd: 60000.5, magnitudeErr: 0.1, filter: 'r', exposureId: 'exp-001' })).toBe(false);
  });

  it('rejects numeric filter', () => {
    expect(isLightCurvePoint({ ...validPoint, filter: 42 })).toBe(false);
  });

  it('rejects empty object', () => {
    expect(isLightCurvePoint({})).toBe(false);
  });
});

describe('isTapQueryResult', () => {
  const validResult: TapQueryResult = {
    status: 'completed',
    rowCount: 100,
    columns: [{ name: 'ra', datatype: 'double' }],
    rows: [{ ra: 62.0 }],
  };

  it('accepts valid completed result', () => {
    expect(isTapQueryResult(validResult)).toBe(true);
  });

  it('accepts executing status', () => {
    expect(isTapQueryResult({ ...validResult, status: 'executing' })).toBe(true);
  });

  it('accepts error status', () => {
    expect(isTapQueryResult({ ...validResult, status: 'error' })).toBe(true);
  });

  it('rejects null', () => {
    expect(isTapQueryResult(null)).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(isTapQueryResult({ ...validResult, status: 'unknown' })).toBe(false);
  });

  it('rejects non-array columns', () => {
    expect(isTapQueryResult({ ...validResult, columns: 'invalid' })).toBe(false);
  });

  it('rejects non-array rows', () => {
    expect(isTapQueryResult({ ...validResult, rows: 'invalid' })).toBe(false);
  });

  it('rejects non-numeric rowCount', () => {
    expect(isTapQueryResult({ ...validResult, rowCount: '100' })).toBe(false);
  });
});

describe('isConeSearchParams', () => {
  const validParams = { ra: 62.0, dec: -37.0, radius: 10, catalog: 'Object' };

  it('accepts valid cone search params', () => {
    expect(isConeSearchParams(validParams)).toBe(true);
  });

  it('rejects null', () => {
    expect(isConeSearchParams(null)).toBe(false);
  });

  it('rejects invalid catalog name', () => {
    expect(isConeSearchParams({ ...validParams, catalog: 'Invalid' })).toBe(false);
  });

  it('rejects missing radius', () => {
    expect(isConeSearchParams({ ra: 62.0, dec: -37.0, catalog: 'Object' })).toBe(false);
  });

  it('rejects string radius', () => {
    expect(isConeSearchParams({ ...validParams, radius: '10' })).toBe(false);
  });
});

describe('isValidCatalogName', () => {
  it('accepts Object', () => {
    expect(isValidCatalogName('Object')).toBe(true);
  });

  it('accepts Source', () => {
    expect(isValidCatalogName('Source')).toBe(true);
  });

  it('accepts DiaObject', () => {
    expect(isValidCatalogName('DiaObject')).toBe(true);
  });

  it('accepts DiaSource', () => {
    expect(isValidCatalogName('DiaSource')).toBe(true);
  });

  it('accepts ForcedSource', () => {
    expect(isValidCatalogName('ForcedSource')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidCatalogName('')).toBe(false);
  });

  it('rejects unknown name', () => {
    expect(isValidCatalogName('Unknown')).toBe(false);
  });

  it('rejects lowercase variant', () => {
    expect(isValidCatalogName('object')).toBe(false);
  });
});
