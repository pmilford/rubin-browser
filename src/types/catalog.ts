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
