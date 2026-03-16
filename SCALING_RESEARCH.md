# Astronomical Image Scaling Research

## The Problem

Astronomical images have enormous dynamic range — a single FITS image might have pixel values from 0.1 (sky background) to 100,000 (bright star core). The human eye can perceive ~100:1 contrast ratio. We need scaling functions that compress this range intelligently.

## Standard Astronomical Scaling Methods

### 1. ZScale (IRAF/DS9) — The Gold Standard

**What it does:** Automatically finds the best display range near the median, ignoring outliers. This is the DEFAULT in DS9, Aladin, JS9 — every professional astronomical viewer.

**Algorithm (from IRAF DISPLAY task):**
1. Sample up to N pixels (e.g., 10,000) evenly across the image
2. Sort by brightness → I(i) where i is rank
3. Fit a linear function to the central portion with iterative rejection:
   `I(i) = intercept + slope * (i - midpoint)`
4. If >50% of points are rejected → no well-defined slope → use full range
5. Otherwise compute:
   ```
   z1 = I(midpoint) + (slope / contrast) * (1 - midpoint)
   z2 = I(midpoint) + (slope / contrast) * (npoints - midpoint)
   ```
6. Clip z1, z2 to be within original sample range

**Key parameters:**
- `contrast` (default 0.25): Higher = more contrast (narrower range)
- `nsample` (default 10000): Number of pixels to sample

**Why it's important:** ZScale gives a "reasonable" display range automatically without manual adjustment. Users expect this.

**Current implementation issues:** The existing `zscaleRange()` does NOT do iterative rejection. It fits a line to the 25th-75th percentile range but doesn't reject outliers from the fit. This can give wrong display ranges for images with strong sources.

### 2. Asinh (Arcsinh) Stretch — Best for HDR

**Formula (Astropy):**
```
y = asinh(x / a) / asinh(1 / a)
```
Where:
- x ∈ [0, 1] (already normalized pixel value)
- a ∈ (0, 1]: "softening parameter" — smaller = more nonlinear
- a → 0: exponential-like stretch (aggressive)
- a → 1: nearly linear

**The Lupton RGB formulation (more common in practice):**
```
y = asinh(x * Q) / asinh(Q)   or equivalently   y = sinh(Q * x) / sinh(Q)
```
Where Q controls the nonlinearity (Q ~ 1-10 for typical images).

**Siril's asinh (with black point):**
```
pixel = (original - blackpoint) * asinh(original * stretch) / (original * asinh(stretch))
```

**Current implementation issues:**
- Uses `sigma = range/10` — this is an arbitrary hack, not a proper noise estimate
- Doesn't match standard formulations (Astropy or Lupton)
- Should use a proper softening parameter `a` that the user can control

### 3. Midtone Transfer Function (MTF) — Siril's Auto-Stretch

**Formula:**
```
MTF(x) = (m - 1) * x / ((2m - 1) * x - m)
```
Where:
- x ∈ [0, 1] (normalized after black/white point subtraction)
- m ∈ (0, 1): midtone balance parameter
  - m = 0.5: identity (no change)
  - m → 0: aggressive darkening
  - m → 1: aggressive brightening

**Properties:**
- MTF(0) = 0
- MTF(m) = 0.5
- MTF(1) = 1

**Auto midtone estimation:** For astronomical images with peaked histograms, the midtone can be estimated from the median:
```
m = (median - blackpoint) / (whitepoint - blackpoint)
```

### 4. Sinh Stretch (Astropy)

**Formula:**
```
y = sinh(x / a) / sinh(1 / a)
```

Inverse of asinh — compresses faint structure while keeping bright regions linear. Used in Lupton RGB composites.

### 5. Log (Logarithmic)

**Standard formula:**
```
y = log(1 + x * (b - 1)) / log(b)
```
Where b is the base (typically 10 or 1000).

### 6. Sqrt (Square Root)

**Formula:** `y = sqrt(x)`

Simple but effective for revealing faint structure. Less aggressive than log.

### 7. Histogram Equalization

Distributes pixel values evenly across the output range. **Warning:** Can wash out faint structures in astronomical images because a few bright pixels compress everything else.

### 8. Power/Gamma

**Formula:** `y = x^gamma`
- gamma < 1: brightens shadows
- gamma > 1: darkens shadows

### 9. Percentile Clipping

Use Nth-Mth percentile as black/white points (common: 0.1%-99.9%). Simple, robust, good for automated display.

## References

- IRAF DISPLAY task: https://iraf.noao.edu/
- JS9/DS9 zscale: https://js9.si.edu/js9/plugins/help/scalecontrols.html
- Astropy visualization: https://docs.astropy.org/en/stable/visualization/normalization.html
- Lupton et al. 2004, "Preparing Red-Green-Blue (RGB) Images from CCD Data": https://www.astro.princeton.edu/~rhl/Papers/truecolor.pdf
- Siril stretching: https://siril.readthedocs.io/en/stable/processing/stretching.html
- Montage brightness: http://montage.ipac.caltech.edu/docs/Stretches/

## Implementation Priority

1. **Fix zscale** — must match IRAF algorithm with iterative rejection
2. **Fix asinh** — use standard formulation with proper softening parameter
3. **Add MTF** — Siril's best auto-stretch method
4. **Add sinh** — useful complement to asinh
5. **Fix log** — use proper base-10 formula with configurable softening
6. **All stretches must operate on [0,1] normalized input** — normalization (black point → white point) happens first, then stretch is applied
