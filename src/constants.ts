/** Constants for Rubin Browser — filters, surveys, and mock data */

/** LSST filter band metadata */
export interface FilterInfo {
  /** Filter band name */
  name: string;
  /** Central wavelength in nanometers */
  wavelength: number;
  /** Hex color for UI display */
  color: string;
  /** Brief description */
  description: string;
}

/** LSST ugrizy filter definitions */
export const LSST_FILTERS: readonly FilterInfo[] = [
  { name: 'u', wavelength: 367, color: '#6251d6', description: 'Ultraviolet (367 nm)' },
  { name: 'g', wavelength: 482, color: '#2ca84f', description: 'Green (482 nm)' },
  { name: 'r', wavelength: 622, color: '#c4332e', description: 'Red (622 nm)' },
  { name: 'i', wavelength: 754, color: '#d57e26', description: 'Near-IR (754 nm)' },
  { name: 'z', wavelength: 869, color: '#a85f21', description: 'Z-band (869 nm)' },
  { name: 'y', wavelength: 971, color: '#8a4f1e', description: 'Y-band (971 nm)' },
] as const;

/** Filter band name type */
export type FilterBand = 'u' | 'g' | 'r' | 'i' | 'z' | 'y';

/** All valid filter band names */
export const FILTER_BANDS: readonly FilterBand[] = ['u', 'g', 'r', 'i', 'z', 'y'] as const;

/** Get filter info by band name */
export function getFilterInfo(band: string): FilterInfo | undefined {
  return LSST_FILTERS.find(f => f.name === band);
}

/** Survey overlay definitions for multi-wavelength sky views */
export interface SurveyInfo {
  /** Short identifier */
  id: string;
  /** Display name */
  name: string;
  /** HiPS URL for Aladin Lite */
  hipsUrl: string;
  /** Survey description */
  description: string;
  /** Wavelength regime */
  waveband: string;
}

/** Available survey overlays */
export const SURVEY_OVERLAYS: readonly SurveyInfo[] = [
  {
    id: 'gaia-dr3',
    name: 'Gaia DR3',
    hipsUrl: 'https://cdn.jsdelivr.net/gh/gaia-cds/gaia-hips/',
    description: 'Gaia Data Release 3 optical photometry',
    waveband: 'Optical (G band)',
  },
  {
    id: 'dss2-color',
    name: 'DSS2 Color',
    hipsUrl: 'https://alasky.cds.unistra.fr/DSS/DSSColor/',
    description: 'Digitized Sky Survey 2 color composite',
    waveband: 'Optical (BVR)',
  },
  {
    id: '2mass-j',
    name: '2MASS J',
    hipsUrl: 'https://alasky.cds.unistra.fr/2MASS/J/',
    description: 'Two Micron All Sky Survey J-band',
    waveband: 'Near-IR (1.25 µm)',
  },
  {
    id: 'sdss-color',
    name: 'SDSS Color',
    hipsUrl: 'https://alasky.cds.unistra.fr/SDSS/Color/',
    description: 'Sloan Digital Sky Survey color composite',
    waveband: 'Optical (ugr)',
  },
  {
    id: 'panstarrs-dr1',
    name: 'PanSTARRS DR1',
    hipsUrl: 'https://alasky.cds.unistra.fr/Pan-STARRS/DR1/color-i-r-g/',
    description: 'Panoramic Survey Telescope and Rapid Response System DR1',
    waveband: 'Optical (grizy)',
  },
] as const;

/** Get survey info by ID */
export function getSurveyInfo(id: string): SurveyInfo | undefined {
  return SURVEY_OVERLAYS.find(s => s.id === id);
}

/** Mock epoch data for time series (simulates DP1 observations) */
export interface MockEpoch {
  mjd: number;
  filter: FilterBand;
}

/** Generate mock epochs spanning ~2 years with multiple filters */
export function generateMockEpochs(count: number = 30): MockEpoch[] {
  const epochs: MockEpoch[] = [];
  const baseMjd = 60000; // ~April 2023
  const filters: FilterBand[] = ['g', 'r', 'i'];

  for (let i = 0; i < count; i++) {
    const mjd = baseMjd + i * 25 + (Math.random() * 5 - 2.5);
    const filter = filters[i % filters.length] ?? 'r';
    epochs.push({ mjd: Math.round(mjd * 100) / 100, filter });
  }

  return epochs.sort((a, b) => a.mjd - b.mjd);
}

/** Default mock epochs for development */
export const DEFAULT_MOCK_EPOCHS: readonly MockEpoch[] = generateMockEpochs(30);
