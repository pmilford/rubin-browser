# User Guide

## Getting Started

### 1. Get Your RSP Token

1. Visit [data.lsst.cloud](https://data.lsst.cloud)
2. Log in with your Rubin Observatory account
3. Go to **Security → Tokens**
4. Create a new token (copy it — you won't see it again)

### 2. Launch Rubin Browser

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### 3. Enter Your Token

On first launch, you'll be prompted for your RSP token. Paste it and click **Connect**.

## Sky Map

The main view shows a full-sky HiPS survey image. You can:

- **Pan** — Click and drag
- **Zoom** — Scroll wheel or pinch
- **Search** — Click any region to run a cone search
- **Overlay** — Toggle survey layers (g, r, i bands)

## Catalog Search

Use the search panel to query Rubin catalogs:

**Quick search:**
- Enter coordinates (RA, Dec) and radius
- Select catalog (Object, Source, DiaObject)
- Click **Search**

**Advanced (ADQL):**
- Switch to ADQL mode
- Write custom queries like:
  ```sql
  SELECT TOP 100 objectId, coord_ra, coord_dec, g_mag, r_mag
  FROM dp02_dc2_catalogs.Object
  WHERE g_mag < 24
  ```

## Object Viewer

Click any object in search results to see:

- **Photometry** — Magnitudes in all filters (u, g, r, i, z, y)
- **Light Curve** — Time-series photometry plot
- **Cutouts** — Postage stamp images at different epochs
- **Properties** — Shape, classification, redshift (if available)

## Galaxy Analysis

For galaxies, the **Galaxy View** provides:

- **Multi-epoch cutouts** — See how the galaxy appears over time
- **Stacked image** — Coadd of all epochs for deeper view
- **Light curve** — Supernova or AGN variability detection
- **Morphology** — Ellipticity, Petrosian radius, Sérsic fit

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search box |
| `Esc` | Close panels |
| `←` `→` | Navigate between objects |
| `s` | Toggle sky overlay |
| `c` | Center on coordinates |
| `?` | Show all shortcuts |
