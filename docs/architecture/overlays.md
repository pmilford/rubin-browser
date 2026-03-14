# Survey Overlay Architecture

## Overview

Multiple sky surveys can be overlaid at the same WCS position, scale, and rotation.

## Components

### SurveySelector (`src/components/SurveySelector.svelte`)

- Checkbox list of available surveys
- Per-survey opacity slider (0-100%)
- Add/remove overlays dynamically

## Available Surveys

Defined in `src/constants.ts` as `SURVEYS`:

| Survey | HiPS Source | Description |
|--------|------------|-------------|
| Gaia DR3 | `cdn.jsdelivr.net/gh/gaia-cds/gaia-hips/` | Star catalog, 1.8B sources |
| DSS2 Color | `alasky.cds.unistra.fr/DSS/DSSColor/` | Digitized Sky Survey, optical |
| 2MASS J | `alasky.cds.unistra.fr/2MASS/J/` | Near-infrared survey |
| SDSS Color | `alasky.cds.unistra.fr/SDSS/Color/` | Sloan Digital Sky Survey |

## Rendering

Overlays use Aladin Lite's layer system:
- Each survey is a separate HiPS layer
- Opacity controlled per-layer
- All layers share the same WCS (center RA/Dec, rotation, FOV)

## Data Flow

```
SurveySelector → onOverlayAdd(survey) → TileViewer → Aladin.addHiPSLayer(survey)
SurveySelector → onOpacityChange(survey, opacity) → Aladin.setOpacity(layer, opacity)
```
