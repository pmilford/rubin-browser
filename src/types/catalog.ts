/** Rubin Observatory catalog types */

export interface Coordinates {
  ra: number;  // degrees
  dec: number; // degrees
}

export interface Photometry {
  u: number | null;
  g: number | null;
  r: number | null;
  i: number | null;
  z: number | null;
  y: number | null;
}

export interface CatalogObject {
  objectId: string;
  coordinates: Coordinates;
  photometry: Photometry;
  extendedness: number | null; // 0=star, 1=galaxy
  redshift: number | null;
  classification: string | null;
}

export interface LightCurvePoint {
  mjd: number;       // Modified Julian Date
  magnitude: number;
  magnitudeErr: number;
  filter: string;
  exposureId: string;
}

export interface LightCurve {
  objectId: string;
  points: LightCurvePoint[];
}

export interface GalaxyProperties {
  objectId: string;
  ellipticity: number;
  petrosianRadius: number; // arcsec
  sersicN: number | null;
  sersicReff: number | null; // arcsec
}

export interface TapQueryResult {
  status: 'completed' | 'executing' | 'error';
  rowCount: number;
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  jobId?: string;
}

export interface ColumnDef {
  name: string;
  datatype: string;
  unit?: string;
  description?: string;
}

export interface ConeSearchParams extends Coordinates {
  radius: number; // arcsec
  catalog: CatalogName;
  maxRecords?: number;
}

export type CatalogName =
  | 'Object'
  | 'Source'
  | 'DiaObject'
  | 'DiaSource'
  | 'ForcedSource';

const CATALOG_NAMES: readonly CatalogName[] = ['Object', 'Source', 'DiaObject', 'DiaSource', 'ForcedSource'];

/** Type guard: validates a value is a valid Coordinates object */
export function isCoordinates(v: unknown): v is Coordinates {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.ra === 'number' && typeof o.dec === 'number';
}

/** Type guard: validates a value is a valid Photometry object */
export function isPhotometry(v: unknown): v is Photometry {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const bands = ['u', 'g', 'r', 'i', 'z', 'y'] as const;
  return bands.every(b => o[b] === null || typeof o[b] === 'number');
}

/** Type guard: validates a value is a valid CatalogObject */
export function isCatalogObject(v: unknown): v is CatalogObject {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.objectId === 'string' &&
    isCoordinates(o.coordinates) &&
    isPhotometry(o.photometry) &&
    (o.extendedness === null || typeof o.extendedness === 'number') &&
    (o.redshift === null || typeof o.redshift === 'number') &&
    (o.classification === null || typeof o.classification === 'string')
  );
}

/** Type guard: validates a value is a valid LightCurvePoint */
export function isLightCurvePoint(v: unknown): v is LightCurvePoint {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.mjd === 'number' &&
    typeof o.magnitude === 'number' &&
    typeof o.magnitudeErr === 'number' &&
    typeof o.filter === 'string' &&
    typeof o.exposureId === 'string'
  );
}

/** Type guard: validates a value is a valid TapQueryResult */
export function isTapQueryResult(v: unknown): v is TapQueryResult {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    (o.status === 'completed' || o.status === 'executing' || o.status === 'error') &&
    typeof o.rowCount === 'number' &&
    Array.isArray(o.columns) &&
    Array.isArray(o.rows)
  );
}

/** Type guard: validates a value is a valid ConeSearchParams */
export function isConeSearchParams(v: unknown): v is ConeSearchParams {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.ra === 'number' &&
    typeof o.dec === 'number' &&
    typeof o.radius === 'number' &&
    isValidCatalogName(String(o.catalog))
  );
}

/** Type guard: validates a string is a valid CatalogName */
export function isValidCatalogName(v: string): v is CatalogName {
  return (CATALOG_NAMES as readonly string[]).includes(v);
}
