# UI Layout Architecture

## Overview

The Rubin Browser uses a compact overlay-style UI that maximizes the image viewing area while keeping all controls accessible.

## Layout Structure

```
┌─────────────────────────────────────────────┐
│  CompactToolbar (always visible)            │
│  [☰] [Search...] [🔍] │ [+] [−] [↻] ... [⛶] [?] │
├─────────────────────────────────────────────┤
│                                             │
│                                             │
│              ImageViewer (full area)        │
│              (OpenSeadragon)                │
│                                             │
│                                             │
├─────────────────────────────────────────────┤
│  ColorBar                                   │
│  StatusBar (RA, Dec, Zoom, Message)         │
└─────────────────────────────────────────────┘

When SidePanel is open:
┌──────────────────────────┬──────────────────┐
│  CompactToolbar          │                  │
├──────────────────────────┤   SidePanel      │
│                          │   (overlay)      │
│   ImageViewer            │                  │
│                          │  ▶ Display       │
│                          │  ▶ Filters       │
│                          │  ▶ Surveys       │
│                          │  ▶ Time Series   │
│                          │  ▶ Blink         │
│                          │  ▶ Pixel Readout │
├──────────────────────────┤                  │
│  ColorBar  │ StatusBar   │                  │
└──────────────────────────┴──────────────────┘
```

## Components

### CompactToolbar
- **Location:** `src/components/CompactToolbar.svelte`
- **Purpose:** Minimal always-visible toolbar with essential controls
- **Controls:** Menu toggle (☰), Search input + Go, Zoom in/out, Reset, Fullscreen, Help
- **Props:** `panelOpen`, `isFullscreen`, callback functions

### SidePanel
- **Location:** `src/components/SidePanel.svelte`
- **Purpose:** Collapsible overlay panel for detailed controls
- **Behavior:** Slides in from the right, semi-transparent overlay behind it
- **Sections:** Accordion-style — only one section open at a time
- **Props:** `open`, control values, callback functions

### TileViewer (main view)
- **Location:** `src/views/TileViewer.svelte`
- **Purpose:** Composes all components, manages global state
- **Responsibilities:** State management, keyboard shortcuts, fullscreen API

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Close side panel OR toggle UI visibility |
| `H` | Toggle help modal |
| `F` | Toggle fullscreen |
| `+` / `=` | Zoom in |
| `-` / `_` | Zoom out |
| `0` | Reset view |

## State Management

All state lives in `TileViewer.svelte` using Svelte 5 `$state()` runes:
- `panelOpen` — side panel visibility
- `isFullscreen` — fullscreen mode
- `uiVisible` — whether toolbar/status bar are shown
- Display settings (`scaling`, `colorMap`, `interpolation`)
- Filter, survey overlay, blink, and time series state

## HiPS Authentication

The image viewer (`ImageViewer.svelte`) supports two HiPS modes:

1. **Public (default):** Uses DSS2 Color from CDS — no authentication required
2. **Authenticated:** When an RSP token is available, uses Rubin Science Platform HiPS with Bearer token in `ajaxHeaders`

The `rspToken` prop controls this behavior. When empty/absent, public HiPS is used.

## Fullscreen Integration

Uses the [Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API):
- `document.documentElement.requestFullscreen()` enters fullscreen
- `document.exitFullscreen()` leaves fullscreen
- `fullscreenchange` event keeps `isFullscreen` state in sync
- In fullscreen, the toolbar remains visible but can be hidden with `Escape`
