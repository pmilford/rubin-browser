# Time Series Architecture

## Overview

The time series system lets users scrub through multi-epoch observations of a
field and blink between them.

> **Status:** The epoch data is **mock**. There is no real DP1 time-series
> integration yet — epochs are synthesized at startup (see below). The slider,
> play/pause, and blink controls are wired to this mock data.

## Components

### TimeSlider (`src/components/TimeSlider.svelte`)

- Displays current epoch as MJD (Modified Julian Date) and human-readable date
- Slider for scrubbing through epochs
- Play/pause button for auto-advance
- Step forward/backward buttons
- Configurable play interval (default: 1 second per epoch)

### Data Flow

```
TimeSlider → onEpochChange(index, epoch) → TileViewer (updates state/status)
```

The mock epochs do not currently drive different imagery in `ImageViewer`;
selecting an epoch updates app state and the status line only.

## Epoch Data

Generated in `src/constants.ts` by `generateMockEpochs()`, with
`DEFAULT_MOCK_EPOCHS` (30 epochs) consumed by `TileViewer`:
- Synthetic MJD values (~25-day cadence) cycling through the g/r/i bands
- **Mock only** — not real DP1 observations
- Planned production path: a TAP query for distinct observation epochs of the
  field (replacing the mock generator)

## MJD Conversion

MJD (Modified Julian Date) is the standard astronomical time format:
- MJD 0 = November 17, 1858 00:00 UTC
- Conversion: `Date = MJD - 40587` (days since Unix epoch)
