/**
 * The seven Rubin DP1 target fields.
 *
 * DP1 (Data Preview 1) is NOT an all-sky release — it is seven ~1 deg² fields
 * (~15 deg² total) imaged with the LSST Commissioning Camera in late 2024. Rubin
 * HiPS tiles (`/api/hips/v2/dp1/deep_coadd/…`) exist ONLY over these fields, so a
 * view centred anywhere else 404s and the viewer degrades to public DSS. This
 * table powers the "Jump to DP1 field" control so a user can navigate straight
 * onto real Rubin coverage.
 *
 * Coordinates are field centres in ICRS degrees, from the DP1 paper
 * (arXiv:2603.23786) / dp1.lsst.io. The broader releases (DP2 ~3000 deg², Oct–Dec
 * 2026; DR1 ~2028) are not wired here yet.
 */

export interface Dp1Field {
  /** Short id (stable, used in the selector). */
  id: string;
  /** Human-readable field name. */
  name: string;
  /** Field-centre right ascension, ICRS degrees [0, 360). */
  ra: number;
  /** Field-centre declination, ICRS degrees [-90, 90]. */
  dec: number;
}

export const DP1_FIELDS: readonly Dp1Field[] = [
  { id: 'ecdfs', name: 'ECDFS (Extended Chandra Deep Field-South)', ra: 53.13, dec: -28.1 },
  { id: 'edfs', name: 'EDFS (Euclid Deep Field-South)', ra: 59.1, dec: -48.73 },
  { id: 'fornax', name: 'Fornax dSph', ra: 40.0, dec: -34.45 },
  { id: '47tuc', name: '47 Tuc (globular cluster)', ra: 6.02, dec: -72.08 },
  { id: 'seagull', name: 'Seagull Nebula', ra: 106.23, dec: -10.51 },
  { id: 'sv95-25', name: 'Rubin SV 95 −25', ra: 95.0, dec: -25.0 },
  { id: 'sv38+7', name: 'Rubin SV 38 +7 (low ecliptic)', ra: 37.86, dec: 6.98 },
];

/** Total DP1 sky area, square degrees (7 fields, ~15 deg² incl. overlap/mosaic). */
export const DP1_TOTAL_AREA_DEG2 = 15;

/**
 * FOV (deg) to frame a DP1 field on "Jump to field". Each field is a ~1 deg²
 * LSSTComCam coadd, so a ~1.5° FOV shows the whole field with a little context.
 * At the default 22.5° browse FOV the field is a <1%-of-frame speck (invisible),
 * which is why the jump must zoom in — see gotoDp1Field in TileViewer.
 */
export const DP1_FIELD_VIEW_FOV_DEG = 1.5;
