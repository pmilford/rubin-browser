/**
 * Plain-language glossary — the single source of truth for the domain jargon the
 * UI exposes (BACKLOG #11). Two audiences the user shouldn't have to already know:
 * Rubin/LSST data-release terms and astronomy / Virtual-Observatory terms.
 *
 * Each entry has a friendly one-liner (`short`, ≤120 chars) suitable for a hover
 * tooltip (`title=`), plus an optional 1–2 sentence `long` for a "?" panel.
 *
 * Copy rules: plain and CORRECT. Facts here are load-bearing — the unit tests
 * assert specific ones (DP1 = 7 fields ~15 deg², SODA = IVOA cutout protocol, MJD
 * = Modified Julian Date, HEALPix = equal-area sphere pixelisation, HiPS =
 * progressive multi-resolution tiles) so a placeholder definition fails CI.
 *
 * Consumers should resolve terms through {@link lookup}, which is case- and
 * separator-insensitive, rather than indexing {@link GLOSSARY} directly.
 */

export interface GlossaryEntry {
  /** Canonical display term, e.g. "DP1", "HEALPix", "RA / Dec". */
  term: string;
  /** ≤120-char friendly one-liner for a hover tooltip (`title=`). */
  short: string;
  /** Optional 1–2 sentence expansion for a "?" glossary panel. */
  long?: string;
}

/**
 * Term → definition map. Keys are stable, lowercase, hyphenated slugs
 * (e.g. 'dp1', 'deep-coadd', 'color-composite'). Prefer {@link lookup} over
 * direct indexing so callers get separator/case tolerance for free.
 */
export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ─── Rubin / LSST data releases & tables ────────────────────────────────
  dp1: {
    term: 'DP1',
    short:
      "Rubin's first data release: 7 small fields (~15 deg² total), one image stack per colour filter.",
    long: 'Data Preview 1 — the first release of Vera C. Rubin Observatory data, taken with the Commissioning Camera in late 2024. It covers seven ~1 deg² fields (~15 deg² total), coadded per filter (ugrizy). It is NOT all-sky, so views outside these fields fall back to public DSS imagery.',
  },
  dp2: {
    term: 'DP2',
    short: "Rubin's second, much larger data preview (~3000 deg²), expected late 2026.",
    long: 'Data Preview 2 — the next Rubin release after DP1, covering roughly 3000 deg² from early main-survey operations. Not wired into this viewer yet.',
  },
  dr1: {
    term: 'DR1',
    short: "Rubin's first full Data Release from the 10-year LSST survey, expected around 2028.",
    long: 'Data Release 1 — the first of the annual, survey-wide Rubin/LSST data releases (as opposed to the smaller DP previews). Expected around 2028.',
  },
  coadd: {
    term: 'coadd',
    short: 'A deep image built by stacking many aligned exposures to boost signal and hide noise.',
    long: 'A coadd (or coadded image) combines many single exposures of the same sky, registered and summed, going deeper than any one visit and averaging out noise and transient artefacts.',
  },
  'deep-coadd': {
    term: 'deep_coadd',
    short: "Rubin's deepest per-filter stacked image of a field — the default HiPS layer for DP1.",
    long: 'The deep_coadd is the deepest coadd Rubin builds for a field in each filter, stacking the best-quality exposures. In this viewer the DP1 HiPS tiles come from deep_coadd (e.g. /api/hips/v2/dp1/deep_coadd/color_gri).',
  },
  visit: {
    term: 'visit',
    short: 'One Rubin pointing at one time — a single (usually pair-of-snaps) exposure of a field.',
    long: 'A visit is a single observation of a field at a given time, the basic unit of the survey. Repeated visits over time give the multi-epoch imagery behind light curves and difference imaging.',
  },
  forcedsource: {
    term: 'ForcedSource',
    short: 'Brightness measured at a fixed catalog position in every visit — the basis of a light curve.',
    long: "ForcedSource is per-visit \"forced photometry\": flux measured at a known object's position in each visit whether or not it was detected, giving an evenly-sampled light curve (used here via dp1.ForcedSource JOIN dp1.Visit).",
  },
  diasource: {
    term: 'DIASource',
    short: 'A single detection in one difference image — one alert/transient measurement at one epoch.',
    long: 'A Difference-Image-Analysis Source is a source found in a single difference image (a visit minus a template). Each is one alert-level detection at one epoch; a moving or varying object produces many.',
  },
  diaobject: {
    term: 'DIAObject',
    short: 'A transient/variable object assembled from its repeated DIASource detections over time.',
    long: 'A DIAObject groups the DIASources that belong to the same physical transient or variable source across epochs, giving its position and difference-flux history.',
  },
  rsp: {
    term: 'RSP',
    short: 'Rubin Science Platform — the online portal/services (Notebook, Portal, APIs) for Rubin data.',
    long: 'The Rubin Science Platform is the web environment for accessing Rubin data, including the Portal, Notebooks, and the TAP/SODA/HiPS APIs this viewer talks to. Access to proprietary data (DP1) needs an RSP account with data rights.',
  },
  'data-rights': {
    term: 'data rights',
    short: 'Permission to access proprietary Rubin data before it becomes public — needed for DP1.',
    long: 'Rubin data is proprietary to data-rights holders (Rubin/LSST members and partners) for a period before public release. DP1 requires an RSP account with data rights; without it this viewer degrades to public DSS/CDS imagery.',
  },

  // ─── Astronomy / Virtual Observatory ────────────────────────────────────
  hips: {
    term: 'HiPS',
    short: 'Progressive multi-resolution sky tiles: coarse tiles far out, sharper ones as you zoom in.',
    long: 'Hierarchical Progressive Survey — an IVOA standard that stores an all-sky image as a HEALPix-indexed pyramid of tiles at increasing orders, so a viewer fetches only the tiles it needs at the current zoom (like map tiles for the sky).',
  },
  healpix: {
    term: 'HEALPix',
    short: 'An equal-area pixelisation of the sphere into 12·4^order same-size diamond cells.',
    long: 'Hierarchical Equal Area isoLatitude Pixelisation divides the sphere into 12 base pixels, each recursively quartered, so every cell at a given order has the same area. It gives HiPS tiles and Rubin catalogs their spatial indexing (NESTED scheme here).',
  },
  wcs: {
    term: 'WCS',
    short: 'World Coordinate System — the mapping between image pixels and sky coordinates (RA/Dec).',
    long: "A World Coordinate System is the header metadata (CRVAL/CRPIX/CDELT/CD, CTYPE) that maps an image's pixel grid to sky coordinates and back, so you can tell where each pixel points on the sky.",
  },
  soda: {
    term: 'SODA',
    short: 'The IVOA cutout protocol — ask a server for just a small region of a big image.',
    long: 'Server-side Operations for Data Access is the IVOA standard for server-side image cutouts: instead of downloading a whole image you request a circle/box around a position and get back just that stamp (used for FITS cutouts, auth-gated).',
  },
  tap: {
    term: 'TAP',
    short: 'Table Access Protocol — the IVOA standard for running catalog queries over the web.',
    long: 'The Table Access Protocol is the IVOA standard service for querying astronomical catalogs with ADQL, in sync or async mode. Rubin exposes DP1 catalogs (Object, ForcedSource, Visit…) over TAP.',
  },
  adql: {
    term: 'ADQL',
    short: "SQL for the sky — the query language for catalog searches, with cone/region functions.",
    long: 'Astronomical Data Query Language is an SQL dialect for TAP services, adding geometric functions (CONTAINS, POINT, CIRCLE) so you can do cone and region searches on catalogs.',
  },
  mjd: {
    term: 'MJD',
    short: 'Modified Julian Date — a running day count starting at midnight on 1858-11-17.',
    long: 'The Modified Julian Date is a continuous count of days (with a fractional part for time of day) since 1858-11-17 00:00 UTC. Astronomy uses it for observation times; e.g. MJD 60000 is 2023-02-25.',
  },
  moc: {
    term: 'MOC',
    short: 'Multi-Order Coverage map — a compact HEALPix description of which sky area a dataset covers.',
    long: 'A Multi-Order Coverage map encodes an arbitrary sky region as a set of HEALPix cells at mixed orders, giving a compact, exact footprint for a survey or catalog that is fast to intersect and test.',
  },
  'gnomonic-tan': {
    term: 'Gnomonic (TAN)',
    short: 'The tangent-plane sky projection this viewer uses — straight lines map to great circles.',
    long: 'The gnomonic (a.k.a. TAN, tangent-plane) projection maps the sphere onto a plane touching it at the view centre; great circles become straight lines. It is exact near the centre and distorts far out, which is why wide-FOV tiles need piecewise-affine subdivision here.',
  },
  fits: {
    term: 'FITS',
    short: 'The standard astronomy image/table file format — keeps full-precision pixels plus a header.',
    long: 'Flexible Image Transport System is the standard file format for astronomical data. Unlike 8-bit JPEG tiles it preserves the original (often float) pixel values and a metadata header (WCS, BUNIT), so it keeps real flux and full dynamic range.',
  },
  bitpix: {
    term: 'BITPIX',
    short: 'The FITS header value giving each pixel’s data type: 8/16/32-bit int or -32/-64 float.',
    long: 'BITPIX is the FITS header keyword for the pixel data type and size: 8, 16, 32 (integers) or -32, -64 (IEEE floats). It tells a reader how many bytes each pixel is and how to interpret them.',
  },
  bscale: {
    term: 'BSCALE',
    short: 'FITS scaling factor: true value = BSCALE × stored + BZERO, to pack floats into ints.',
    long: 'BSCALE (with BZERO) linearly rescales stored FITS pixels to physical values (physical = BSCALE·stored + BZERO), letting integer storage represent a scaled or offset float range.',
  },
  arcmin: {
    term: 'arcmin',
    short: 'Arcminute — 1/60 of a degree of angle on the sky (the full Moon is about 30 arcmin across).',
    long: 'An arcminute (′) is 1/60 of a degree. It is a convenient scale for fields of view and separations; the DP1 fields are ~1 degree (60 arcmin) across.',
  },
  arcsec: {
    term: 'arcsec',
    short: 'Arcsecond — 1/3600 of a degree; the scale of individual stars, PSFs, and pixels.',
    long: 'An arcsecond (″) is 1/60 of an arcminute, or 1/3600 of a degree. Rubin’s pixels are ~0.2 arcsec and typical image sharpness (seeing/PSF) is around 1 arcsec.',
  },
  ra: {
    term: 'RA',
    short: 'Right Ascension — the sky’s east-west (longitude-like) coordinate, 0–360°.',
    long: 'Right Ascension is the celestial equivalent of longitude, measured eastward around the celestial equator from 0° to 360° (or 0–24 hours). This viewer works in degrees internally.',
  },
  dec: {
    term: 'Dec',
    short: 'Declination — the sky’s north-south (latitude-like) coordinate, −90° to +90°.',
    long: 'Declination is the celestial equivalent of latitude, from +90° at the north celestial pole through 0° at the equator to −90° at the south pole.',
  },
  fov: {
    term: 'FOV',
    short: 'Field of view — how much sky is visible on screen; smaller FOV = more zoomed in.',
    long: 'The field of view is the angular size of the region shown in the viewer (e.g. in degrees or arcmin). Zooming narrows the FOV and, via fovToOrder, raises the HiPS tile order fetched.',
  },
  'color-composite': {
    term: 'colour composite',
    short: 'A colour image made by mapping different filters to red/green/blue (vs one grey single band).',
    long: 'A colour composite assigns separate filter images to the R, G and B channels (e.g. i→red, r→green, g→blue) to make a colour picture, as opposed to a single-band image which is one filter shown in greyscale or a colormap.',
  },

  // ─── Terms that appear elsewhere in this app's UI ───────────────────────
  lupton: {
    term: 'Lupton stretch',
    short: 'An asinh colour scaling (Lupton et al.) that shows faint and bright features together.',
    long: 'The Lupton (asinh) stretch maps multi-band flux to colour with an inverse-hyperbolic-sine intensity scale, keeping faint galaxy outskirts visible while preserving colour in bright cores that a linear stretch would saturate to white.',
  },
  nside: {
    term: 'Nside',
    short: 'The HEALPix resolution parameter, Nside = 2^order; the sphere splits into 12·Nside² pixels.',
    long: 'Nside sets HEALPix resolution: Nside = 2^order, and the sphere is divided into 12·Nside² equal-area pixels. Higher order/Nside means smaller tiles and finer detail.',
  },
  order: {
    term: 'HiPS order',
    short: 'The HiPS/HEALPix zoom level: higher order = smaller, sharper tiles (Nside = 2^order).',
    long: 'The order is the HEALPix depth of a HiPS tile level. Order 0 is the 12 base pixels; each step up quarters every tile. This viewer picks the order from the field of view via fovToOrder.',
  },
  graticule: {
    term: 'graticule',
    short: 'The overlaid grid of RA/Dec lines on the sky (curved under the gnomonic projection).',
    long: 'A graticule is the coordinate grid of constant-RA and constant-Dec lines drawn over the view. Because of the gnomonic projection these lines are drawn curved, alongside a compass and scale bar.',
  },
  'proper-motion': {
    term: 'proper motion',
    short: "A star's slow drift across the sky over years, measured in mas or arcsec per year.",
    long: 'Proper motion is the apparent angular motion of a star across the sky (perpendicular to the line of sight) due to its real space velocity, typically milliarcseconds per year. Nearby stars move fastest.',
  },
  'ab-mag': {
    term: 'AB magnitude',
    short: 'A flux-calibrated brightness scale where mag is a fixed function of physical flux density.',
    long: 'The AB magnitude system defines brightness directly from flux density (mag = −2.5·log10(f/3631 Jy)), so a given AB mag means the same physical flux in any filter — unlike the older star-referenced Vega system. Smaller magnitudes are brighter.',
  },
  nanojansky: {
    term: 'nanojansky (nJy)',
    short: 'The tiny flux-density unit Rubin reports fluxes in — 1 nJy = 10⁻⁹ jansky.',
    long: 'The jansky (Jy) is the radio/astronomy unit of flux density (10⁻²⁶ W m⁻² Hz⁻¹); a nanojansky is 10⁻⁹ Jy. Rubin catalogs report source fluxes in nJy, which convert to AB magnitudes (31.4 AB mag = 1 nJy).',
  },
  'gaia-dr3': {
    term: 'Gaia DR3',
    short: "ESA Gaia's third data release — a ~1.8-billion-star catalog with positions, motions and G/BP/RP.",
    long: 'Gaia Data Release 3 is the European Space Agency Gaia mission’s catalog of ~1.8 billion sources with precise positions, parallaxes, proper motions and three-band (G, BP, RP) photometry. Here it is available as a public CDS HiPS image overlay.',
  },
  panstarrs: {
    term: 'Pan-STARRS',
    short: 'A wide northern-sky optical survey (grizy) from Hawaii, available here as a HiPS overlay.',
    long: 'The Panoramic Survey Telescope and Rapid Response System (Pan-STARRS) is a wide-field optical survey covering the northern sky in five bands (grizy), used here as a public CDS HiPS image overlay.',
  },
  '2mass': {
    term: '2MASS',
    short: 'The Two Micron All-Sky Survey — an all-sky near-infrared (J/H/Ks) survey overlay.',
    long: 'The Two Micron All-Sky Survey imaged the entire sky in three near-infrared bands (J 1.25 µm, H 1.65 µm, Ks 2.17 µm), useful for seeing through dust. Available here as a public CDS HiPS overlay.',
  },
  wise: {
    term: 'WISE',
    short: 'The Wide-field Infrared Survey Explorer — an all-sky mid-infrared survey overlay.',
    long: 'WISE is a NASA space telescope that mapped the whole sky in mid-infrared bands (3.4–22 µm), tracing dust, star formation and asteroids. Available here as a public CDS HiPS overlay.',
  },
  dss: {
    term: 'DSS',
    short: 'The Digitized Sky Survey — public all-sky photographic imagery; this viewer’s no-login fallback.',
    long: 'The Digitized Sky Survey is scanned photographic plates covering the whole sky, served publicly by CDS as HiPS. With no Rubin token (or outside DP1 coverage) this viewer degrades to DSS colour imagery so it always shows something.',
  },
};

/**
 * Collapse case and any run of separators/punctuation (spaces, underscores,
 * hyphens, slashes, parentheses…) to single hyphens, so 'DP 1', 'dp_1', 'dp-1'
 * and 'nanojansky (nJy)' all normalise to a stable comparable slug.
 */
function normalize(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Pre-built lookup index: every key (already a slug) mapped by its normalized form. */
const NORMALIZED_INDEX: Record<string, GlossaryEntry> = (() => {
  const index: Record<string, GlossaryEntry> = {};
  for (const [key, entry] of Object.entries(GLOSSARY)) {
    index[normalize(key)] = entry;
    // Also index the human-readable term (e.g. "deep_coadd", "nanojansky (nJy)")
    // so a caller can look up by what the UI actually displays, not just the slug.
    index[normalize(entry.term)] = entry;
  }
  return index;
})();

/**
 * Resolve a term to its glossary entry, case- and separator-insensitively.
 * `lookup('DP1')`, `lookup('dp1')`, `lookup('deep coadd')` and
 * `lookup('deep_coadd')` all resolve; unknown terms return `undefined`.
 */
export function lookup(term: string): GlossaryEntry | undefined {
  if (!term) return undefined;
  return NORMALIZED_INDEX[normalize(term)];
}
