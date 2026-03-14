# Filter System Architecture

## Overview

Rubin/LSST observes in six photometric bands: u, g, r, i, z, y.

## Components

### FilterSelector (`src/components/FilterSelector.svelte`)

- Single-band mode: select one filter, display with colormap
- RGB composite mode: assign any 3 filters to R/G/B channels
- Filter buttons show filter name and central wavelength

## Filter Definitions

Defined in `src/constants.ts` as `FILTERS`:

| Filter | Wavelength (nm) | Description |
|--------|----------------|-------------|
| u | 367 | Ultraviolet |
| g | 482 | Green |
| r | 622 | Red |
| i | 754 | Near-infrared |
| z | 869 | Infrared |
| y | 971 | Far-infrared |

## RGB Composite

Users select 3 filters for R, G, B channels. Common combinations:
- **True color**: r→R, g→G, u→B (approximate)
- **Enhanced**: i→R, r→G, g→B (emphasizes structure)
- **Near-IR**: y→R, z→G, i→B (penetrates dust)

## Data Flow

```
FilterSelector → onFilterChange(filter) → TileViewer → ImageViewer.loadFilter(filter)
FilterSelector → onCompositeChange({r,g,b}) → ImageViewer.loadComposite({r,g,b})
```
