# User Guide

## Getting Started

### 1. Launch Rubin Browser

```bash
npm run dev
```

Open `http://localhost:5173` in your browser. The viewer starts on **public DSS
preview imagery** from CDS — no login is required to pan around the sky.

### 2. (Optional) Enter Your RSP Token

To view Rubin Science Platform data you need an RSP token.

**Get a token:**
1. Visit [data.lsst.cloud](https://data.lsst.cloud) and log in with your Rubin
   Observatory account.
2. Open your **username menu → Security Tokens**.
3. Click **Create Token** and grant the scopes `read:image` and `read:tap`.
4. Copy the token (you won't see it again).

**Enter it in the app:**
1. Click the **🔑** button in the toolbar.
2. Paste your token into the dialog. Optionally click **Validate** to test it.
3. Click **Save**. The viewer switches to Rubin HiPS while the token is valid.

Use **Clear / Log out** in the same dialog to remove the token. Tokens live in
the browser session only and are never written to disk.

> Access to Rubin DP1 data requires an account with data rights. Without one,
> only the public DSS/CDS preview imagery works.

## Sky Viewer

The main view shows HiPS survey imagery rendered to a canvas. You can:

- **Pan** — Click and drag
- **Zoom** — Scroll wheel, the **+ / −** toolbar buttons, or the `+` / `-` keys
- **Reset view** — The reset button or the `0` key
- **Search / go to** — Type into the search box: `RA, Dec` in degrees
  (e.g. `62.0, -37.0`), sexagesimal (e.g. `4h8m0s -37d0m0s`), or an object name
  (e.g. `M42`)
- **Minimap** — The all-sky minimap shows your field of view; click or drag it
  to jump to a new position

## Display Controls

Open the side panel (**☰** in the toolbar) to adjust:

- **Scaling** — linear, log, sqrt, asinh, sinh, mtf, histogram, zscale,
  percentile
- **Color map** — grayscale, viridis, plasma, inferno, hot, cool
- **Interpolation** — nearest, bilinear, bicubic, lanczos
- **Invert** — flip the image (toolbar button or the `I` key)
- **Pixel readout** — RA/Dec and pixel value under the cursor
- **WCS grid** — coordinate grid, N/E indicator, and scale bar

## Survey Overlays

In the **Surveys** section of the side panel you can layer public CDS HiPS
surveys over the base image, each with its own opacity:

- Gaia DR3, DSS2 Color, 2MASS J, WISE, PanSTARRS DR1

These overlays are public and need no token.

## Object Browser

The Object Browser lets you jump to objects from a bundled **local** catalog —
selected Messier objects, bright stars, popular galaxies, nebulae, and clusters.
Selecting an object recenters the viewer on its coordinates.

> The Object Browser is a navigation aid backed by a static local list
> (`src/data/objects.ts`). It does not query Rubin catalogs.

## Time Series & Blink (mock data)

The **Time Series** and **Blink** sections let you scrub through epochs and
auto-advance/blink between them. **These epochs are currently mock data**
generated in `src/constants.ts`; they do not reflect real DP1 observations yet.

## Filters (UI preview)

The **Filters** section exposes single-band and RGB-composite selectors for the
u/g/r/i/z/y bands. The controls are in place, but band-specific imagery is not
yet wired to the viewer, so changing them does not yet reload per-band data.

## Not Yet Available

The following are planned but not implemented:

- TAP/ADQL catalog search UI
- SODA image cutouts
- Object photometry and light curves
- Galaxy analysis / stacking

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `+` / `=` | Zoom in |
| `-` / `_` | Zoom out |
| `0` | Reset view |
| `I` | Toggle invert |
| `F` | Toggle fullscreen |
| `H` | Toggle help modal |
| `Esc` | Close side panel, or toggle UI visibility |
