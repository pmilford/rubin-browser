# Survey Overlay Architecture

## Overview

Multiple sky surveys can be overlaid at the same WCS position, scale, and rotation.

## Components

### SurveySelector (`src/components/SurveySelector.svelte`)

- Checkbox list of available surveys
- Per-survey opacity slider (0-100%)
- Add/remove overlays dynamically

## Available Surveys

Defined in `src/constants.ts` as `SURVEY_OVERLAYS`. All are public CDS/alasky
HiPS sources and need no token:

| Survey | HiPS Source | Description |
|--------|------------|-------------|
| Gaia DR3 | `cdn.jsdelivr.net/gh/gaia-cds/gaia-hips/` | Gaia DR3 optical photometry |
| DSS2 Color | `alasky.cds.unistra.fr/DSS/DSSColor/` | Digitized Sky Survey, optical |
| 2MASS J | `alasky.cds.unistra.fr/2MASS/J/` | Near-infrared survey |
| WISE Color | `alasky.cds.unistra.fr/WISE/W4` | Mid-IR (22 µm) |
| PanSTARRS DR1 | `alasky.cds.unistra.fr/Pan-STARRS/DR1/color-i-r-g/` | Optical grizy |

## Rendering

Overlays are drawn by the custom canvas `ImageViewer` (no Aladin Lite):
- Each survey's HiPS tiles are fetched and drawn over the base image
- Opacity controlled per overlay
- All overlays share the current view WCS (center RA/Dec, FOV) via the same
  HEALPix tile indexing + gnomonic projection as the base layer

## Data Flow

```
SurveySelector → onOverlayAdd(survey)   → TileViewer → ImageViewer.addOverlay(id, url, opacity)
SurveySelector → onOpacityChange(id, o) → TileViewer → ImageViewer.setOverlayOpacity(id, o)
SurveySelector → onOverlayRemove(id)    → TileViewer → ImageViewer.removeOverlay(id)
```
