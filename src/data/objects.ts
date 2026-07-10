/**
 * Catalog of astronomical objects for the Object Browser and name search.
 *
 * The bulk data lives in `catalog-data.ts` (3029 REAL objects parsed from the
 * HYG star database + HYG DSO catalog — bright stars to V≤5.5, all 110 Messier,
 * and named NGC/IC highlights; see that file's header for sources). This module
 * cleans it up for display, adds common-name aliases so famous objects resolve
 * by their popular names, and provides lookup / search / nearest-object helpers.
 */

import { angularSeparation, positionAngle } from '../utils/skyGeom.js';
import { CATALOG_OBJECTS, type ObjectType, type CatalogObject } from './catalog-data.js';

export type { ObjectType } from './catalog-data.js';

export interface AstroObject {
  id: string;
  name: string;
  ra: number;
  dec: number;
  /** Catalog grouping (Named Stars / Bright Stars / Messier / NGC/IC). */
  category: string;
  /** Physical type — the primary axis for filtering. */
  type: ObjectType;
  magnitude: number;
  spectralType?: string;
  description?: string;
}

/** Catalog groupings, in display order. */
export const OBJECT_CATEGORIES = [
  'Named Stars',
  'Bright Stars',
  'Messier',
  'NGC/IC',
] as const;

export type ObjectCategory = typeof OBJECT_CATEGORIES[number];

/** Physical types present in the catalog, in display order. */
export const OBJECT_TYPES: readonly ObjectType[] = [
  'star',
  'double-star',
  'galaxy',
  'open-cluster',
  'globular-cluster',
  'nebula',
  'planetary-nebula',
  'supernova-remnant',
  'other',
];

/** Human-readable label for a physical type. */
export const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  star: 'Star',
  'double-star': 'Double star',
  galaxy: 'Galaxy',
  'open-cluster': 'Open cluster',
  'globular-cluster': 'Globular cluster',
  nebula: 'Nebula',
  'planetary-nebula': 'Planetary nebula',
  'supernova-remnant': 'Supernova remnant',
  other: 'Other',
};

/**
 * Popular names for famous objects the source catalog lists only by number
 * (e.g. "M31 (NGC 224)"). Merged into `description` so a search for "Andromeda"
 * or "Orion Nebula" still finds them. Keyed by catalog id.
 */
const COMMON_NAMES: Record<string, string> = {
  'M-1': 'Crab Nebula', 'M-8': 'Lagoon Nebula', 'M-16': 'Eagle Nebula',
  'M-17': 'Omega Nebula', 'M-20': 'Trifid Nebula', 'M-27': 'Dumbbell Nebula',
  'M-31': 'Andromeda Galaxy', 'M-33': 'Triangulum Galaxy', 'M-42': 'Orion Nebula',
  'M-44': 'Beehive Cluster', 'M-45': 'Pleiades', 'M-51': 'Whirlpool Galaxy',
  'M-57': 'Ring Nebula', 'M-63': 'Sunflower Galaxy', 'M-64': 'Black Eye Galaxy',
  'M-78': 'reflection nebula in Orion', 'M-81': "Bode's Galaxy", 'M-82': 'Cigar Galaxy',
  'M-87': 'Virgo A', 'M-97': 'Owl Nebula', 'M-101': 'Pinwheel Galaxy',
  'M-104': 'Sombrero Galaxy', 'M-13': 'Hercules Cluster', 'M-11': 'Wild Duck Cluster',
  'NGC-7000': 'North America Nebula', 'NGC-7293': 'Helix Nebula',
};

/** Collapse the source catalog's padded whitespace in designations. */
function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** All catalog objects, cleaned for display, with common-name aliases merged. */
export const ALL_OBJECTS: AstroObject[] = (CATALOG_OBJECTS as CatalogObject[]).map((o) => {
  const alias = COMMON_NAMES[o.id];
  return {
    id: o.id,
    name: cleanName(o.name),
    ra: o.ra,
    dec: o.dec,
    category: o.category,
    type: o.type,
    magnitude: o.magnitude,
    spectralType: o.spectralType,
    description: alias ?? o.description,
  };
});

/** Objects in a given catalog grouping. */
export function getObjectsByCategory(category: ObjectCategory): AstroObject[] {
  return ALL_OBJECTS.filter((obj) => obj.category === category);
}

/** Objects of a given physical type. */
export function getObjectsByType(type: ObjectType): AstroObject[] {
  return ALL_OBJECTS.filter((obj) => obj.type === type);
}

function compact(s: string): string {
  return s.toLowerCase().replace(/[\s\-_()]/g, '');
}

/**
 * Look up a single object by name/id (case-insensitive). Handles Messier
 * numbers ("M31" → id "M-31"), popular aliases ("Andromeda"), and substrings.
 */
export function lookupObject(name: string): AstroObject | undefined {
  const q = name.toLowerCase().trim();
  if (!q) return undefined;
  const qc = compact(q);
  // Prefer an exact id / compact-id match, then an alias/name match.
  return (
    ALL_OBJECTS.find((o) => o.id.toLowerCase() === q || compact(o.id) === qc) ??
    ALL_OBJECTS.find(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.description?.toLowerCase().includes(q) ?? false)
    )
  );
}

/** Fuzzy multi-field search over the catalog (name, id, description, spectral type). */
export function searchObjects(query: string): AstroObject[] {
  if (!query.trim()) return ALL_OBJECTS;
  const lower = query.toLowerCase();
  return ALL_OBJECTS.filter(
    (obj) =>
      obj.id.toLowerCase().includes(lower) ||
      obj.name.toLowerCase().includes(lower) ||
      (obj.description?.toLowerCase().includes(lower) ?? false) ||
      (obj.spectralType?.toLowerCase().includes(lower) ?? false)
  );
}

export interface NearestObjectResult {
  object: AstroObject;
  /** Great-circle separation from the query point, in degrees. */
  separationDeg: number;
  /** Position angle query→object, degrees East of North [0,360). */
  positionAngleDeg: number;
}

/**
 * Nearest catalog object to a sky position (great-circle). Linear scan over the
 * ~3000 objects — trivially cheap, called throttled from the cursor readout.
 * Returns the TRUE minimum with its real separation (it never claims an object
 * is "here" when the nearest is far away); null only if the catalog is empty.
 */
export function nearestObject(ra: number, dec: number): NearestObjectResult | null {
  let best: AstroObject | null = null;
  let bestSep = Infinity;
  for (const obj of ALL_OBJECTS) {
    const sep = angularSeparation(ra, dec, obj.ra, obj.dec);
    if (sep < bestSep) {
      bestSep = sep;
      best = obj;
    }
  }
  if (!best) return null;
  return {
    object: best,
    separationDeg: bestSep,
    positionAngleDeg: positionAngle(ra, dec, best.ra, best.dec),
  };
}

/** Result of a click-identify: the matched object (within threshold) or an honest
 *  no-match, always carrying the clicked coordinates. */
export interface IdentifyResult {
  /** Nearest object IF within the match radius; null when nothing is close. */
  match: NearestObjectResult | null;
  /** The nearest object regardless of distance (for the "nearest is N away" hint). */
  nearest: NearestObjectResult | null;
  /** Match radius (deg) used for this identification. */
  matchRadiusDeg: number;
}

/**
 * Identify the object at a clicked sky position. Unlike {@link nearestObject},
 * this THRESHOLDS the result: the bundled catalog is bright objects only, so over
 * most of the sky the nearest cataloged object is degrees away and reporting it as
 * "here" is misleading. `match` is non-null only when the nearest object is within
 * `matchRadiusDeg` (default scales with the zoomed field of view, floored at 1′),
 * so an empty-sky click honestly returns no match. `nearest` is always the true
 * nearest (for a "nearest catalogued object is N.N° away" hint).
 */
export function identifyAt(ra: number, dec: number, matchRadiusDeg = 0.5): IdentifyResult {
  const nearest = nearestObject(ra, dec);
  const match = nearest && nearest.separationDeg <= matchRadiusDeg ? nearest : null;
  return { match, nearest, matchRadiusDeg };
}

/** A click-identify result plus the clicked sky point + constellation, for the panel. */
export interface IdentifyInfo extends IdentifyResult {
  /** Clicked RA (deg). */
  ra: number;
  /** Clicked Dec (deg). */
  dec: number;
  /** Constellation the clicked point falls in. */
  constellation: string;
}
