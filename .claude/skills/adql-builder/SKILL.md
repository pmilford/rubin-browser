---
name: adql-builder
description: Build ADQL queries for Rubin Observatory TAP service. Use when writing or debugging ADQL queries against the DP1 catalogs.
auto: false
---

# ADQL Query Builder

Reference for building ADQL (Astronomical Data Query Language) queries for the Rubin Observatory TAP service.

## Quick Reference

### Cone Search

```sql
SELECT TOP 100 *
FROM dp02_dc2_catalogs.Object
WHERE CONTAINS(
  POINT('ICRS', coord_ra, coord_dec),
  CIRCLE('ICRS', ${ra}, ${dec}, ${radius_deg})
) = 1
```

Note: TAP expects radius in **degrees**. Convert arcsec: `radius_deg = radius_arcsec / 3600`.

### Common Catalogs

| Catalog | Use |
|---------|-----|
| `dp02_dc2_catalogs.Object` | Coadded object catalog (main) |
| `dp02_dc2_catalogs.Source` | Single-visit detections |
| `dp02_dc2_catalogs.DiaObject` | Difference image objects (transients) |
| `dp02_dc2_catalogs.DiaSource` | Single-visit difference detections |
| `dp02_dc2_catalogs.ForcedSource` | Forced photometry |

### Common Columns

```sql
objectId,
coord_ra, coord_dec,
detect_isPrimary,
g_mag, r_mag, i_mag, z_mag, y_mag,     -- PSF magnitudes
g_magErr, r_magErr, i_magErr,           -- magnitude errors
refExtendedness,                         -- 0=point, 1=extended
x, y                                     -- pixel coordinates
```

### Filtering

```sql
-- Magnitude cut
WHERE r_mag < 24.5

-- Primary detections only
WHERE detect_isPrimary = 1

-- Stars only
WHERE refExtendedness = 0

-- Galaxies only
WHERE refExtendedness = 1

-- Combine conditions
WHERE detect_isPrimary = 1
  AND r_mag BETWEEN 18 AND 25
  AND refExtendedness = 1
```

### Joins (Object ↔ ForcedSource)

```sql
SELECT o.objectId, o.coord_ra, o.coord_dec,
       f.band, f.psfMag, f.psfMagErr, f.midpointMjdTai
FROM dp02_dc2_catalogs.Object o
JOIN dp02_dc2_catalogs.ForcedSource f ON o.objectId = f.objectId
WHERE o.objectId = 123456789
  AND f.band = 'r'
ORDER BY f.midpointMjdTai
```

### Time Series Query

```sql
SELECT s.midpointMjdTai, s.band, s.psfMag, s.psfMagErr,
       s.scienceExposureId
FROM dp02_dc2_catalogs.Source s
WHERE s.objectId = ${objectId}
  AND s.detect_isPrimary = 1
ORDER BY s.midpointMjdTai
```

### Spatial Constraints

```sql
-- Box search
WHERE coord_ra BETWEEN ${ra_min} AND ${ra_max}
  AND coord_dec BETWEEN ${dec_min} AND ${dec_max}

-- Polygon
WHERE CONTAINS(
  POINT('ICRS', coord_ra, coord_dec),
  POLYGON('ICRS', ${ra1}, ${dec1}, ${ra2}, ${dec2}, ${ra3}, ${dec3})
) = 1
```

## Tips

- Always use `TOP N` to limit results (TAP has size limits)
- Use `detect_isPrimary = 1` to avoid duplicates
- Prefer PSF magnitudes (`psfMag`) for point sources, `cModelMag` for galaxies
- Column names are case-sensitive in ADQL
- Use single quotes for string values
- Comments (`--`) are allowed in ADQL

## In Code

Use the builder functions in `src/api/tap.ts`:

```typescript
import { buildConeSearch } from '../api/tap.js';

const adql = buildConeSearch({
  ra: 62.0,
  dec: -37.0,
  radius: 10, // arcsec
  catalog: 'Object',
  maxRecords: 100,
});
```
