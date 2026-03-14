/** Catalog of interesting astronomical objects for the Object Browser */

export interface AstroObject {
  id: string;
  name: string;
  ra: number;
  dec: number;
  category: string;
  magnitude?: number;
  description?: string;
}

export const OBJECT_CATEGORIES = [
  'Messier',
  'Bright Stars',
  'Popular Galaxies',
  'Nebulae',
  'Clusters',
] as const;

export type ObjectCategory = typeof OBJECT_CATEGORIES[number];

/** Messier catalog objects (selected highlights M1-M110) */
const MESSIER_OBJECTS: AstroObject[] = [
  { id: 'M1', name: 'M1 (Crab Nebula)', ra: 83.63, dec: 22.01, category: 'Messier', magnitude: 8.4, description: 'Supernova remnant in Taurus' },
  { id: 'M2', name: 'M2', ra: 323.36, dec: -0.82, category: 'Messier', magnitude: 6.5, description: 'Globular cluster in Aquarius' },
  { id: 'M3', name: 'M3', ra: 205.55, dec: 28.38, category: 'Messier', magnitude: 6.2, description: 'Globular cluster in Canes Venatici' },
  { id: 'M4', name: 'M4', ra: 245.90, dec: -26.53, category: 'Messier', magnitude: 5.6, description: 'Globular cluster in Scorpius' },
  { id: 'M5', name: 'M5', ra: 229.64, dec: 2.08, category: 'Messier', magnitude: 5.6, description: 'Globular cluster in Serpens' },
  { id: 'M6', name: 'M6 (Butterfly Cluster)', ra: 265.07, dec: -32.25, category: 'Messier', magnitude: 4.2, description: 'Open cluster in Scorpius' },
  { id: 'M7', name: 'M7 (Ptolemy\'s Cluster)', ra: 268.47, dec: -34.79, category: 'Messier', magnitude: 3.3, description: 'Open cluster in Scorpius' },
  { id: 'M8', name: 'M8 (Lagoon Nebula)', ra: 270.92, dec: -24.38, category: 'Messier', magnitude: 6.0, description: 'Emission nebula in Sagittarius' },
  { id: 'M9', name: 'M9', ra: 259.80, dec: -18.52, category: 'Messier', magnitude: 7.7, description: 'Globular cluster in Ophiuchus' },
  { id: 'M10', name: 'M10', ra: 254.29, dec: -4.10, category: 'Messier', magnitude: 6.6, description: 'Globular cluster in Ophiuchus' },
  { id: 'M11', name: 'M11 (Wild Duck Cluster)', ra: 282.77, dec: -6.27, category: 'Messier', magnitude: 6.3, description: 'Open cluster in Scutum' },
  { id: 'M13', name: 'M13 (Hercules Cluster)', ra: 250.42, dec: 36.46, category: 'Messier', magnitude: 5.8, description: 'Globular cluster in Hercules' },
  { id: 'M15', name: 'M15', ra: 322.49, dec: 12.17, category: 'Messier', magnitude: 6.2, description: 'Globular cluster in Pegasus' },
  { id: 'M16', name: 'M16 (Eagle Nebula)', ra: 274.70, dec: -13.81, category: 'Messier', magnitude: 6.4, description: 'Star cluster with emission nebula in Serpens' },
  { id: 'M17', name: 'M17 (Omega Nebula)', ra: 275.12, dec: -16.18, category: 'Messier', magnitude: 6.0, description: 'Emission nebula in Sagittarius' },
  { id: 'M20', name: 'M20 (Trifid Nebula)', ra: 270.63, dec: -23.03, category: 'Messier', magnitude: 9.0, description: 'Emission nebula in Sagittarius' },
  { id: 'M22', name: 'M22', ra: 279.10, dec: -23.90, category: 'Messier', magnitude: 5.1, description: 'Globular cluster in Sagittarius' },
  { id: 'M27', name: 'M27 (Dumbbell Nebula)', ra: 299.90, dec: 22.72, category: 'Messier', magnitude: 7.4, description: 'Planetary nebula in Vulpecula' },
  { id: 'M31', name: 'M31 (Andromeda Galaxy)', ra: 10.68, dec: 41.27, category: 'Messier', magnitude: 3.4, description: 'Spiral galaxy in Andromeda' },
  { id: 'M32', name: 'M32', ra: 10.67, dec: 40.87, category: 'Messier', magnitude: 8.1, description: 'Dwarf elliptical galaxy, companion of M31' },
  { id: 'M33', name: 'M33 (Triangulum Galaxy)', ra: 23.46, dec: 30.66, category: 'Messier', magnitude: 5.7, description: 'Spiral galaxy in Triangulum' },
  { id: 'M34', name: 'M34', ra: 40.53, dec: 42.78, category: 'Messier', magnitude: 5.2, description: 'Open cluster in Perseus' },
  { id: 'M36', name: 'M36', ra: 84.05, dec: 34.14, category: 'Messier', magnitude: 6.0, description: 'Open cluster in Auriga' },
  { id: 'M37', name: 'M37', ra: 88.04, dec: 32.55, category: 'Messier', magnitude: 5.6, description: 'Open cluster in Auriga' },
  { id: 'M38', name: 'M38', ra: 82.18, dec: 35.85, category: 'Messier', magnitude: 6.4, description: 'Open cluster in Auriga' },
  { id: 'M41', name: 'M41', ra: 101.50, dec: -20.76, category: 'Messier', magnitude: 4.5, description: 'Open cluster in Canis Major' },
  { id: 'M42', name: 'M42 (Orion Nebula)', ra: 83.82, dec: -5.39, category: 'Messier', magnitude: 4.0, description: 'Emission/reflection nebula in Orion' },
  { id: 'M43', name: 'M43 (De Mairan\'s Nebula)', ra: 83.85, dec: -5.27, category: 'Messier', magnitude: 9.0, description: 'HII region in Orion' },
  { id: 'M44', name: 'M44 (Beehive Cluster)', ra: 130.08, dec: 19.67, category: 'Messier', magnitude: 3.7, description: 'Open cluster in Cancer' },
  { id: 'M45', name: 'M45 (Pleiades)', ra: 56.75, dec: 24.12, category: 'Messier', magnitude: 1.6, description: 'Open cluster in Taurus' },
  { id: 'M46', name: 'M46', ra: 115.43, dec: -14.84, category: 'Messier', magnitude: 6.1, description: 'Open cluster in Puppis' },
  { id: 'M48', name: 'M48', ra: 123.42, dec: -5.72, category: 'Messier', magnitude: 5.8, description: 'Open cluster in Hydra' },
  { id: 'M50', name: 'M50', ra: 105.72, dec: -8.36, category: 'Messier', magnitude: 5.9, description: 'Open cluster in Monoceros' },
  { id: 'M51', name: 'M51 (Whirlpool Galaxy)', ra: 202.47, dec: 47.20, category: 'Messier', magnitude: 8.4, description: 'Spiral galaxy in Canes Venatici' },
  { id: 'M52', name: 'M52', ra: 351.15, dec: 61.59, category: 'Messier', magnitude: 6.9, description: 'Open cluster in Cassiopeia' },
  { id: 'M53', name: 'M53', ra: 198.23, dec: 18.17, category: 'Messier', magnitude: 7.6, description: 'Globular cluster in Coma Berenices' },
  { id: 'M57', name: 'M57 (Ring Nebula)', ra: 283.40, dec: 33.03, category: 'Messier', magnitude: 8.8, description: 'Planetary nebula in Lyra' },
  { id: 'M63', name: 'M63 (Sunflower Galaxy)', ra: 198.96, dec: 42.03, category: 'Messier', magnitude: 8.6, description: 'Spiral galaxy in Canes Venatici' },
  { id: 'M64', name: 'M64 (Black Eye Galaxy)', ra: 194.18, dec: 21.68, category: 'Messier', magnitude: 8.5, description: 'Spiral galaxy in Coma Berenices' },
  { id: 'M65', name: 'M65', ra: 169.73, dec: 13.09, category: 'Messier', magnitude: 9.3, description: 'Spiral galaxy in Leo (Leo Triplet)' },
  { id: 'M66', name: 'M66', ra: 170.06, dec: 12.99, category: 'Messier', magnitude: 8.9, description: 'Spiral galaxy in Leo (Leo Triplet)' },
  { id: 'M67', name: 'M67', ra: 132.83, dec: 11.80, category: 'Messier', magnitude: 6.9, description: 'Open cluster in Cancer' },
  { id: 'M74', name: 'M74 (Phantom Galaxy)', ra: 24.17, dec: 15.78, category: 'Messier', magnitude: 9.4, description: 'Spiral galaxy in Pisces' },
  { id: 'M76', name: 'M76 (Little Dumbbell)', ra: 25.97, dec: 51.58, category: 'Messier', magnitude: 10.1, description: 'Planetary nebula in Perseus' },
  { id: 'M77', name: 'M77', ra: 40.67, dec: -0.01, category: 'Messier', magnitude: 8.9, description: 'Spiral galaxy in Cetus' },
  { id: 'M80', name: 'M80', ra: 244.26, dec: -22.98, category: 'Messier', magnitude: 7.3, description: 'Globular cluster in Scorpius' },
  { id: 'M81', name: 'M81 (Bode\'s Galaxy)', ra: 148.89, dec: 69.07, category: 'Messier', magnitude: 6.9, description: 'Spiral galaxy in Ursa Major' },
  { id: 'M82', name: 'M82 (Cigar Galaxy)', ra: 148.97, dec: 69.68, category: 'Messier', magnitude: 8.4, description: 'Starburst galaxy in Ursa Major' },
  { id: 'M83', name: 'M83 (Southern Pinwheel)', ra: 204.25, dec: -29.87, category: 'Messier', magnitude: 7.5, description: 'Spiral galaxy in Hydra' },
  { id: 'M84', name: 'M84', ra: 186.27, dec: 12.89, category: 'Messier', magnitude: 9.1, description: 'Lenticular galaxy in Virgo' },
  { id: 'M85', name: 'M85', ra: 186.35, dec: 18.19, category: 'Messier', magnitude: 9.1, description: 'Lenticular galaxy in Coma Berenices' },
  { id: 'M86', name: 'M86', ra: 186.55, dec: 12.95, category: 'Messier', magnitude: 8.9, description: 'Lenticular galaxy in Virgo' },
  { id: 'M87', name: 'M87 (Virgo A)', ra: 187.71, dec: 12.39, category: 'Messier', magnitude: 8.6, description: 'Elliptical galaxy in Virgo, black hole shadow imaged' },
  { id: 'M88', name: 'M88', ra: 187.99, dec: 14.42, category: 'Messier', magnitude: 9.6, description: 'Spiral galaxy in Coma Berenices' },
  { id: 'M89', name: 'M89', ra: 188.92, dec: 12.56, category: 'Messier', magnitude: 9.8, description: 'Elliptical galaxy in Virgo' },
  { id: 'M90', name: 'M90', ra: 189.21, dec: 13.16, category: 'Messier', magnitude: 9.5, description: 'Spiral galaxy in Virgo' },
  { id: 'M94', name: 'M94', ra: 192.72, dec: 41.12, category: 'Messier', magnitude: 8.2, description: 'Spiral galaxy in Canes Venatici' },
  { id: 'M95', name: 'M95', ra: 160.99, dec: 11.70, category: 'Messier', magnitude: 9.7, description: 'Barred spiral galaxy in Leo' },
  { id: 'M96', name: 'M96', ra: 161.69, dec: 11.82, category: 'Messier', magnitude: 9.2, description: 'Spiral galaxy in Leo' },
  { id: 'M97', name: 'M97 (Owl Nebula)', ra: 168.70, dec: 55.02, category: 'Messier', magnitude: 9.9, description: 'Planetary nebula in Ursa Major' },
  { id: 'M98', name: 'M98', ra: 183.45, dec: 14.90, category: 'Messier', magnitude: 10.1, description: 'Spiral galaxy in Coma Berenices' },
  { id: 'M99', name: 'M99', ra: 184.71, dec: 14.42, category: 'Messier', magnitude: 9.9, description: 'Spiral galaxy in Coma Berenices' },
  { id: 'M100', name: 'M100', ra: 185.73, dec: 15.82, category: 'Messier', magnitude: 9.3, description: 'Spiral galaxy in Coma Berenices' },
  { id: 'M101', name: 'M101 (Pinwheel Galaxy)', ra: 210.80, dec: 54.35, category: 'Messier', magnitude: 7.9, description: 'Spiral galaxy in Ursa Major' },
  { id: 'M104', name: 'M104 (Sombrero Galaxy)', ra: 189.99, dec: -11.62, category: 'Messier', magnitude: 8.0, description: 'Lenticular galaxy in Virgo' },
  { id: 'M106', name: 'M106', ra: 184.74, dec: 47.30, category: 'Messier', magnitude: 8.4, description: 'Spiral galaxy in Canes Venatici' },
  { id: 'M110', name: 'M110', ra: 10.09, dec: 41.69, category: 'Messier', magnitude: 8.5, description: 'Dwarf elliptical galaxy, companion of M31' },
];

/** Bright naked-eye stars */
const BRIGHT_STARS: AstroObject[] = [
  { id: 'Sirius', name: 'Sirius (α CMa)', ra: 101.29, dec: -16.72, category: 'Bright Stars', magnitude: -1.46, description: 'Brightest star in the night sky' },
  { id: 'Canopus', name: 'Canopus (α Car)', ra: 95.99, dec: -52.70, category: 'Bright Stars', magnitude: -0.74, description: 'Second brightest star' },
  { id: 'Arcturus', name: 'Arcturus (α Boo)', ra: 213.92, dec: 19.18, category: 'Bright Stars', magnitude: -0.05, description: 'Brightest star in northern hemisphere' },
  { id: 'Vega', name: 'Vega (α Lyr)', ra: 279.23, dec: 38.78, category: 'Bright Stars', magnitude: 0.03, description: 'Standard for photometric calibration' },
  { id: 'Capella', name: 'Capella (α Aur)', ra: 79.17, dec: 46.00, category: 'Bright Stars', magnitude: 0.08, description: 'Brightest star in Auriga' },
  { id: 'Rigel', name: 'Rigel (β Ori)', ra: 78.63, dec: -8.20, category: 'Bright Stars', magnitude: 0.13, description: 'Blue supergiant in Orion' },
  { id: 'Procyon', name: 'Procyon (α CMi)', ra: 114.83, dec: 5.22, category: 'Bright Stars', magnitude: 0.34, description: 'Brightest star in Canis Minor' },
  { id: 'Betelgeuse', name: 'Betelgeuse (α Ori)', ra: 88.79, dec: 7.41, category: 'Bright Stars', magnitude: 0.42, description: 'Red supergiant in Orion' },
  { id: 'Altair', name: 'Altair (α Aql)', ra: 297.70, dec: 8.87, category: 'Bright Stars', magnitude: 0.76, description: 'Brightest star in Aquila' },
  { id: 'Aldebaran', name: 'Aldebaran (α Tau)', ra: 68.98, dec: 16.51, category: 'Bright Stars', magnitude: 0.85, description: 'Red giant in Taurus' },
  { id: 'Antares', name: 'Antares (α Sco)', ra: 247.35, dec: -26.43, category: 'Bright Stars', magnitude: 1.06, description: 'Red supergiant in Scorpius' },
  { id: 'Spica', name: 'Spica (α Vir)', ra: 201.30, dec: -11.16, category: 'Bright Stars', magnitude: 1.04, description: 'Brightest star in Virgo' },
  { id: 'Pollux', name: 'Pollux (β Gem)', ra: 116.33, dec: 28.03, category: 'Bright Stars', magnitude: 1.14, description: 'Brightest star in Gemini' },
  { id: 'Fomalhaut', name: 'Fomalhaut (α PsA)', ra: 344.41, dec: -29.62, category: 'Bright Stars', magnitude: 1.16, description: 'Brightest star in Piscis Austrinus, has a debris disk' },
  { id: 'Deneb', name: 'Deneb (α Cyg)', ra: 310.36, dec: 45.28, category: 'Bright Stars', magnitude: 1.25, description: 'Blue-white supergiant in Cygnus' },
  { id: 'Polaris', name: 'Polaris (α UMi)', ra: 37.95, dec: 89.26, category: 'Bright Stars', magnitude: 1.98, description: 'North Star, current pole star' },
];

/** Popular well-known galaxies beyond Messier */
const POPULAR_GALAXIES: AstroObject[] = [
  { id: 'NGC-891', name: 'NGC 891', ra: 35.64, dec: 42.35, category: 'Popular Galaxies', magnitude: 10.8, description: 'Edge-on spiral galaxy in Andromeda' },
  { id: 'NGC-1300', name: 'NGC 1300', ra: 49.92, dec: -19.41, category: 'Popular Galaxies', magnitude: 11.2, description: 'Grand-design barred spiral in Eridanus' },
  { id: 'NGC-1365', name: 'NGC 1365', ra: 53.40, dec: -36.14, category: 'Popular Galaxies', magnitude: 10.3, description: 'Barred spiral galaxy in Fornax' },
  { id: 'NGC-2525', name: 'NGC 2525', ra: 121.33, dec: -11.33, category: 'Popular Galaxies', magnitude: 12.2, description: 'Spiral galaxy in Puppis, SN 2018gv host' },
  { id: 'NGC-2903', name: 'NGC 2903', ra: 143.04, dec: 21.50, category: 'Popular Galaxies', magnitude: 9.7, description: 'Barred spiral galaxy in Leo' },
  { id: 'NGC-3314', name: 'NGC 3314', ra: 159.65, dec: -27.62, category: 'Popular Galaxies', magnitude: 13.3, description: 'Overlapping galaxies in Hydra' },
  { id: 'NGC-3370', name: 'NGC 3370', ra: 162.04, dec: 17.26, category: 'Popular Galaxies', magnitude: 12.3, description: 'Spiral galaxy in Leo, Cepheid distance anchor' },
  { id: 'NGC-4038/39', name: 'NGC 4038/39 (Antennae)', ra: 180.47, dec: -18.87, category: 'Popular Galaxies', magnitude: 11.2, description: 'Interacting galaxies in Corvus' },
  { id: 'NGC-4258', name: 'NGC 4258 (M106)', ra: 184.74, dec: 47.30, category: 'Popular Galaxies', magnitude: 8.4, description: 'Spiral galaxy with water masers' },
  { id: 'NGC-4631', name: 'NGC 4631 (Whale Galaxy)', ra: 190.53, dec: 32.54, category: 'Popular Galaxies', magnitude: 9.8, description: 'Edge-on spiral galaxy in Canes Venatici' },
  { id: 'NGC-5128', name: 'NGC 5128 (Centaurus A)', ra: 201.37, dec: -43.02, category: 'Popular Galaxies', magnitude: 6.8, description: 'Nearby active galaxy in Centaurus' },
  { id: 'NGC-6744', name: 'NGC 6744', ra: 287.44, dec: -63.85, category: 'Popular Galaxies', magnitude: 9.1, description: 'Grand-design spiral galaxy in Pavo' },
  { id: 'NGC-6822', name: 'NGC 6822 (Barnard\'s Galaxy)', ra: 296.24, dec: -14.80, category: 'Popular Galaxies', magnitude: 9.3, description: 'Irregular dwarf galaxy in Sagittarius' },
  { id: 'NGC-7331', name: 'NGC 7331', ra: 339.27, dec: 34.42, category: 'Popular Galaxies', magnitude: 10.4, description: 'Spiral galaxy in Pegasus, Milky Way analog' },
  { id: 'Leo-Triplet', name: 'Leo Triplet (M65/66/NGC3628)', ra: 170.00, dec: 13.10, category: 'Popular Galaxies', magnitude: 9.0, description: 'Trio of spiral galaxies in Leo' },
];

/** Famous nebulae beyond Messier */
const NEBULAE: AstroObject[] = [
  { id: 'NGC-7293', name: 'NGC 7293 (Helix Nebula)', ra: 337.41, dec: -20.84, category: 'Nebulae', magnitude: 7.6, description: 'Nearest bright planetary nebula' },
  { id: 'NGC-7000', name: 'NGC 7000 (North America Nebula)', ra: 314.70, dec: 44.50, category: 'Nebulae', magnitude: 4.0, description: 'Emission nebula in Cygnus' },
  { id: 'IC-1396', name: 'IC 1396 (Elephant\'s Trunk)', ra: 324.20, dec: 57.50, category: 'Nebulae', magnitude: 3.5, description: 'Emission nebula in Cepheus' },
  { id: 'NGC-3372', name: 'NGC 3372 (Carina Nebula)', ra: 161.27, dec: -59.87, category: 'Nebulae', magnitude: 1.0, description: 'Large emission nebula with Eta Carinae' },
  { id: 'NGC-2024', name: 'NGC 2024 (Flame Nebula)', ra: 85.42, dec: -1.90, category: 'Nebulae', magnitude: 10.0, description: 'Emission nebula near Alnitak in Orion' },
  { id: 'IC-2118', name: 'IC 2118 (Witch Head Nebula)', ra: 65.87, dec: -7.17, category: 'Nebulae', magnitude: 13.0, description: 'Reflection nebula near Rigel' },
  { id: 'NGC-2359', name: 'NGC 2359 (Thor\'s Helmet)', ra: 109.27, dec: -13.17, category: 'Nebulae', magnitude: 11.5, description: 'Emission nebula in Canis Major' },
  { id: 'NGC-6888', name: 'NGC 6888 (Crescent Nebula)', ra: 303.09, dec: 38.35, category: 'Nebulae', magnitude: 7.4, description: 'Emission nebula in Cygnus, Wolf-Rayet bubble' },
  { id: 'IC-434', name: 'IC 434 (Horsehead Nebula)', ra: 86.48, dec: -2.46, category: 'Nebulae', magnitude: 6.8, description: 'Dark nebula silhouette in Orion' },
  { id: 'NGC-2264', name: 'NGC 2264 (Cone Nebula)', ra: 100.24, dec: 9.73, category: 'Nebulae', magnitude: 3.9, description: 'Emission nebula and star cluster in Monoceros' },
];

/** Star clusters beyond Messier */
const CLUSTERS: AstroObject[] = [
  { id: 'NGC-2158', name: 'NGC 2158', ra: 91.98, dec: 24.10, category: 'Clusters', magnitude: 8.6, description: 'Open cluster near M35 in Gemini' },
  { id: 'NGC-2477', name: 'NGC 2477', ra: 118.76, dec: -38.55, category: 'Clusters', magnitude: 5.8, description: 'Rich open cluster in Puppis' },
  { id: 'NGC-2360', name: 'NGC 2360', ra: 109.00, dec: -15.63, category: 'Clusters', magnitude: 7.2, description: 'Open cluster in Canis Major' },
  { id: 'NGC-2362', name: 'NGC 2362', ra: 109.52, dec: -24.99, category: 'Clusters', magnitude: 4.1, description: 'Young open cluster in Canis Major' },
  { id: 'NGC-2420', name: 'NGC 2420', ra: 115.17, dec: 21.57, category: 'Clusters', magnitude: 8.3, description: 'Old open cluster in Gemini' },
  { id: 'NGC-6940', name: 'NGC 6940', ra: 308.87, dec: 28.27, category: 'Clusters', magnitude: 6.3, description: 'Open cluster in Vulpecula' },
  { id: 'NGC-7789', name: 'NGC 7789 (Caroline\'s Cluster)', ra: 359.68, dec: 56.73, category: 'Clusters', magnitude: 6.7, description: 'Rich open cluster in Cassiopeia' },
  { id: 'NGC-188', name: 'NGC 188', ra: 11.77, dec: 85.25, category: 'Clusters', magnitude: 8.1, description: 'Oldest known open cluster' },
  { id: 'NGC-7006', name: 'NGC 7006', ra: 315.37, dec: 16.19, category: 'Clusters', magnitude: 10.6, description: 'Distant globular cluster in Delphinus' },
  { id: 'Omega-Centauri', name: 'Omega Centauri (NGC 5139)', ra: 201.69, dec: -47.48, category: 'Clusters', magnitude: 3.7, description: 'Largest globular cluster in Milky Way' },
];

/** All objects combined */
export const ALL_OBJECTS: AstroObject[] = [
  ...MESSIER_OBJECTS,
  ...BRIGHT_STARS,
  ...POPULAR_GALAXIES,
  ...NEBULAE,
  ...CLUSTERS,
];

/** Lookup object by name (case-insensitive, partial match) */
export function lookupObject(name: string): AstroObject | undefined {
  const lower = name.toLowerCase().trim();
  return ALL_OBJECTS.find(obj =>
    obj.id.toLowerCase() === lower ||
    obj.name.toLowerCase().includes(lower) ||
    obj.id.toLowerCase().replace(/^m(\d)/, 'm$1') === lower.replace(/^m(\d)/, 'm$1')
  );
}

/** Get objects by category */
export function getObjectsByCategory(category: ObjectCategory): AstroObject[] {
  return ALL_OBJECTS.filter(obj => obj.category === category);
}

/** Search objects by name (fuzzy) */
export function searchObjects(query: string): AstroObject[] {
  if (!query.trim()) return ALL_OBJECTS;
  const lower = query.toLowerCase();
  return ALL_OBJECTS.filter(obj =>
    obj.id.toLowerCase().includes(lower) ||
    obj.name.toLowerCase().includes(lower) ||
    (obj.description?.toLowerCase().includes(lower) ?? false)
  );
}
