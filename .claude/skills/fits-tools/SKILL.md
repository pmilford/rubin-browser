---
name: fits-tools
description: Work with FITS image data from Rubin Observatory — parsing cutouts, extracting headers, rendering images. Use when handling FITS files or image data.
auto: false
---

# FITS Tools

Guide for handling FITS (Flexible Image Transport System) data from Rubin Observatory.

## FITS Basics

A FITS file has:
- **Header**: Keyword-value metadata (WCS, exposure info, telescope config)
- **Data**: 2D image array (float32 pixel values)

## Key Header Keywords

```
NAXIS1, NAXIS2    — Image dimensions (pixels)
CRPIX1, CRPIX2    — Reference pixel
CRVAL1, CRVAL2    — Reference pixel coordinates (RA, Dec in degrees)
CDELT1, CDELT2    — Pixel scale (degrees/pixel)
CTYPE1, CTYPE2    — Projection type (e.g., 'RA---TAN', 'DEC--TAN')
EXPTIME           — Exposure time (seconds)
MJD-OBS           — Modified Julian Date of observation
FILTER            — Filter name (g, r, i, z, y)
TELESCOP          — Telescope name
```

## Client-Side FITS Parsing

For browser-based FITS parsing, use **fitsjs** or **astrojs-fits**:

```typescript
import FITS from 'fitsjs';

async function loadFitsCutout(url: string): Promise<FitsImage> {
  const resp = await fetch(url, { headers: getAuthHeader() });
  const buffer = await resp.arrayBuffer();
  const fits = new FITS(buffer);
  const hdu = fits.getHDU();
  const header = hdu.header;
  const data = hdu.data;

  return {
    width: header.get('NAXIS1'),
    height: header.get('NAXIS2'),
    pixels: data,
    wcs: parseWCS(header),
  };
}
```

## SODA Cutout Requests

Request image cutouts from Rubin:

```typescript
async function fetchCutout(
  ra: number,
  dec: number,
  sizeArcsec: number
): Promise<ArrayBuffer> {
  const params = new URLSearchParams({
    RA: String(ra),
    DEC: String(dec),
    WIDTH: String(sizeArcsec / 0.2),  // pixels (0.2 arcsec/pixel)
    HEIGHT: String(sizeArcsec / 0.2),
  });

  const resp = await fetch(
    `https://data.lsst.cloud/api/dp1/cutout?${params}`,
    { headers: getAuthHeader() }
  );

  return resp.arrayBuffer();
}
```

## Pixel Scaling

For display, normalize pixel values:

```typescript
function normalizePixels(
  data: Float32Array,
  min: number,
  max: number
): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const scaled = ((data[i] - min) / (max - min)) * 255;
    result[i] = Math.max(0, Math.min(255, scaled));
  }
  return result;
}
```

Common scaling methods:
- **Linear**: Simple min-max
- **Log**: Better for extended sources (galaxies)
- **Asinh**: Good all-purpose (DS9-style)
- **ZScale**: Auto contrast (used by DS9 default)

## Rendering to Canvas

```typescript
function renderToCanvas(
  pixels: Uint8Array,
  width: number,
  height: number,
  canvas: HTMLCanvasElement
): void {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);

  for (let i = 0; i < pixels.length; i++) {
    const idx = i * 4;
    imageData.data[idx] = pixels[i];     // R
    imageData.data[idx + 1] = pixels[i]; // G
    imageData.data[idx + 2] = pixels[i]; // B
    imageData.data[idx + 3] = 255;       // A
  }

  ctx.putImageData(imageData, 0, 0);
}
```

## WCS Coordinate Transforms

Convert between pixel and sky coordinates:

```typescript
interface WCS {
  crpix: [number, number];
  crval: [number, number];
  cdelt: [number, number];
  ctype: [string, string];
}

function pixToSky(wcs: WCS, x: number, y: number): [number, number] {
  const ra = wcs.crval[0] + (x - wcs.crpix[0]) * wcs.cdelt[0];
  const dec = wcs.crval[1] + (y - wcs.crpix[1]) * wcs.cdelt[1];
  return [ra, dec];
}

function skyToPix(wcs: WCS, ra: number, dec: number): [number, number] {
  const x = wcs.crpix[0] + (ra - wcs.crval[0]) / wcs.cdelt[0];
  const y = wcs.crpix[1] + (dec - wcs.crval[1]) / wcs.cdelt[1];
  return [x, y];
}
```

Note: These are simplified TAN projection. For full WCS support, use the `wcslib` library or `@aspect/wcs`.

## Rubin Pixel Scale

- Rubin/LSST pixel scale: **0.2 arcsec/pixel**
- Typical cutout: 50×50 pixels = 10×10 arcsec
- Full field: ~4k × 4k pixels
