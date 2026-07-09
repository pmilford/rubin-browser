# Filter System Architecture

## Overview

Rubin/LSST observes in six photometric bands: u, g, r, i, z, y.

> **Status:** The filter and RGB-composite **UI** exists, but the canvas viewer
> currently loads a single color HiPS survey and does not yet fetch per-band
> imagery. Changing filters updates app state/status but does not (yet) reload
> band-specific tiles. Treat this document as the intended design.

## Components

### FilterSelector (`src/components/FilterSelector.svelte`)

- Single-band mode: select one filter, display with colormap
- RGB composite mode: assign any 3 filters to R/G/B channels
- Filter buttons show filter name and central wavelength

## Filter Definitions

Defined in `src/constants.ts` as `LSST_FILTERS`:

| Filter | Wavelength (nm) | Description |
|--------|----------------|-------------|
| u | 367 | Ultraviolet |
| g | 482 | Green |
| r | 622 | Red |
| i | 754 | Near-IR |
| z | 869 | Z-band |
| y | 971 | Y-band |

## RGB Composite

Users select 3 filters for R, G, B channels. Common combinations:
- **True color**: r→R, g→G, u→B (approximate)
- **Enhanced**: i→R, r→G, g→B (emphasizes structure)
- **Near-IR**: y→R, z→G, i→B (penetrates dust)

## Data Flow

```
FilterSelector → onFilterChange(filter) → TileViewer (updates state/status)
FilterSelector → onCompositeChange({r,g,b}) → TileViewer (updates state/status)
```

> Wiring these selections to actual per-band tile loading in `ImageViewer` is
> planned but not yet implemented.
