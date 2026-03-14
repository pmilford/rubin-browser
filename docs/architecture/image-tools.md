# Image Tools Architecture

## Overview

Best-in-class tools for large astronomical image inspection.

## Components

### Histogram (`src/components/Histogram.svelte`)

- Pixel value distribution histogram (D3.js rendering)
- Adjustable stretch methods: linear, log, sqrt, asinh, zscale, percentile
- Draggable min/max handles for manual range adjustment
- Updates in real-time as user adjusts stretch

### PixelReadout (`src/components/PixelReadout.svelte`)

- Displays on hover: RA, Dec (WCS), pixel value/flux
- Updates continuously as mouse moves over image
- Coordinate conversion: pixel → sky using WCS transformation

### WcsOverlay (`src/components/WcsOverlay.svelte`)

- Coordinate grid with spacing auto-scaled to FOV
- RA lines shown in hours/minutes (hms format)
- Dec lines shown in degrees/arcminutes (dms format)
- North/East orientation indicator
- Scale bar with appropriate units (degrees or arcminutes)

### ImageViewer Enhancements

- Progressive HiPS tile loading
- Sub-pixel pan/zoom smoothness
- Keyboard shortcuts: +/- zoom, 0 reset, arrow keys pan

## Stretch Methods

| Method | Formula | Best For |
|--------|---------|----------|
| Linear | `(x - min) / (max - min)` | High contrast data |
| Log | `log(1 + x) / log(1 + max)` | Faint structure near bright sources |
| Sqrt | `sqrt(x) / sqrt(max)` | Moderate stretch |
| Asinh | `asinh(x / σ) / asinh(max / σ)` | Wide dynamic range |
| ZScale | IRAF algorithm | Auto-scaling, standard in astronomy |
| Histogram | Equalize pixel distribution | Maximizing visible detail |

## Data Flow

```
Mouse hover → PixelReadout.update(x, y, value, ra, dec)
Stretch change → Histogram → ImageViewer.applyStretch(method, min, max)
FOV change → WcsOverlay → regenerate grid lines at appropriate spacing
```
