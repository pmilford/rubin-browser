# Time Series Architecture

## Overview

The time series system allows users to navigate through multi-epoch observations of the same field.

## Components

### TimeSlider (`src/components/TimeSlider.svelte`)

- Displays current epoch as MJD (Modified Julian Date) and human-readable date
- Slider for scrubbing through epochs
- Play/pause button for auto-advance
- Step forward/backward buttons
- Configurable play interval (default: 1 second per epoch)

### Data Flow

```
TimeSlider → onEpochChange(mjd) → TileViewer → ImageViewer.loadEpoch(mjd)
```

## Epoch Data

Defined in `src/constants.ts` as `EPOCHS` array:
- Mock MJD values representing DP1 observation epochs
- Production: fetched from TAP query on `dp02_dc2_catalogs.Source` for distinct `obs_start` values

## MJD Conversion

MJD (Modified Julian Date) is the standard astronomical time format:
- MJD 0 = November 17, 1858 00:00 UTC
- Conversion: `Date = MJD - 40587` (days since Unix epoch)
