<script lang="ts">
  import ImageViewer from '../components/ImageViewer.svelte';
  import PerfHud from '../components/PerfHud.svelte';
  import type { PerfSnapshot } from '../utils/perfMetrics.js';
  import CompactToolbar from '../components/CompactToolbar.svelte';
  import SidePanel from '../components/SidePanel.svelte';
  import ColorBar from '../components/ColorBar.svelte';
  import StatusBar from '../components/StatusBar.svelte';
  import HelpModal from '../components/HelpModal.svelte';
  import TokenDialog from '../components/TokenDialog.svelte';
  import ObjectBrowser from '../components/ObjectBrowser.svelte';
  import CrossSectionPlot from '../components/CrossSectionPlot.svelte';
  import OfflineLayerControls from '../components/OfflineLayerControls.svelte';
  import ObjectInfoPanel from '../components/ObjectInfoPanel.svelte';
  import SimbadPanel from '../components/SimbadPanel.svelte';
  import { objectsNear, type SimbadObject } from '../api/simbad.js';
  import DiffPanel from '../components/DiffPanel.svelte';
  import VariabilityPanel from '../components/VariabilityPanel.svelte';
  import CutoutPanel from '../components/CutoutPanel.svelte';
  import RgbCompositePanel from '../components/RgbCompositePanel.svelte';
  import { fetchCutoutAt } from '../api/soda.js';
  import { type FitsImage } from '../utils/fits.js';
  import { readFitsImageAsync } from '../utils/fitsCompressed.js';
  import { radecToTileIndex } from '../api/hips.js';
  import CatalogTable from '../components/CatalogTable.svelte';
  import ColorMagnitudeDiagram from '../components/ColorMagnitudeDiagram.svelte';
  import { fetchGaiaCone, type GaiaCatalog } from '../api/gaia.js';
  import { fetchRubinObjects, RUBIN_OBJECT_DEFAULT_RADIUS_DEG } from '../api/rubinObjects.js';
  import { gaiaToCatalogSet, type CatalogSet } from '../data/catalog.js';
  import { lensCatalogSet } from '../data/lenses.js';
  import SurfacePlot from '../components/SurfacePlot.svelte';
  import { OFFLINE_EPOCHS, OFFLINE_BANDS, brightestOfflineVariable, offlineLightCurve } from '../data/offlineDataset.js';
  import LightCurvePlot from '../components/LightCurvePlot.svelte';
  import { RUBIN_DATASETS, fetchDp1Datasets, type RubinDataset } from '../utils/baseLayer.js';
  import type { IdentifyInfo } from '../data/objects.js';
  import type { ImageClassification } from '../utils/objectClassifier.js';
  import type { Band } from '../data/syntheticSky.js';
  import { temporalCrossSectionGrid, type LineProfile } from '../utils/crossSection.js';
  import { parseDs9, serializeDs9, type Ds9Region } from '../utils/ds9Regions.js';
  import type { ScalingFunction, ColorMapName, InterpolationMethod, ViewerState } from '../types/image.js';
  import { SURVEY_OVERLAYS, type SurveyInfo } from '../constants.js';
  import type { FilterBand } from '../constants.js';
  import { onMount } from 'svelte';
  import { readStateFromUrl, applyStateToUrl } from '../utils/urlState.js';
  import { DP1_FIELDS, DP1_FIELD_VIEW_FOV_DEG } from '../data/dp1Fields.js';
  import { fovToZoom } from '../utils/projection.js';
  import { GLOSSARY } from '../data/glossary.js';
  import { getToken, isAuthenticated } from '../api/auth.js';
  import { fetchLightCurve, toLightCurvePoints } from '../api/lightcurve.js';
  import { fetchGaiaLightCurves } from '../api/gaiaLightCurve.js';
  import { fetchDiaAlerts } from '../api/diaSource.js';
  import type { LightCurvePoint } from '../data/offlineDataset.js';
  import { lookupObject, type AstroObject } from '../data/objects.js';
  import {
    generateSyntheticAlerts,
    buildAlertIndex,
    allTypesMask,
    typeVisible,
    alertTimeRange,
    alertsInWindow,
    ALERT_TYPE_NAMES,
    ALERT_TYPE_COLORS,
    type AlertSet,
    type AlertIndex,
    type AlertHit,
  } from '../data/alerts.js';

  // Seed the view from the URL permalink (pure read; {} outside a browser or with
  // no hash). Present keys override defaults; absent keys keep them.
  const seed = readStateFromUrl();

  let scaling: ScalingFunction = $state(seed.scaling ?? 'linear');
  let colorMap: ColorMapName = $state(seed.colorMap ?? 'grayscale');
  let interpolation: InterpolationMethod = $state('bilinear');
  let invert = $state(seed.invert ?? false);
  // Display transfer (DS9-style) — identity at these defaults.
  let blackPoint = $state(0);
  let whitePoint = $state(1);
  let contrast = $state(1);
  let bias = $state(0.5);
  let helpOpen = $state(false);
  let tokenDialogOpen = $state(false);

  // UI state
  let panelOpen = $state(false);
  let isFullscreen = $state(false);
  let uiVisible = $state(true);

  let currentRa = $state(seed.ra ?? 62.0);
  let currentDec = $state(seed.dec ?? -37.0);
  let zoomLevel = $state(seed.zoom ?? 3);
  let statusMessage = $state('Ready');

  // Filter state
  let activeFilter: FilterBand | null = $state(null);
  let compositeMode = $state(false);
  let compositeChannels: { r: FilterBand | null; g: FilterBand | null; b: FilterBand | null } = $state({ r: null, g: null, b: null });

  // Survey overlay state
  interface OverlayEntry {
    survey: SurveyInfo;
    opacity: number;
  }
  let surveyOverlays: OverlayEntry[] = $state([]);

  // Base layer selection. 'auto' defers to the token (Rubin when authenticated,
  // else public DSS); the explicit choices override that regardless of token.
  const BASE_LAYERS = [
    { id: 'auto', name: 'Auto', url: '' },
    { id: 'dss', name: 'DSS2 Color', url: 'https://alasky.cds.unistra.fr/DSS/DSSColor' },
    { id: 'rubin', name: 'Rubin color_gri', url: 'https://data.lsst.cloud/api/hips/v2/dp1/deep_coadd/color_gri' },
    { id: 'offline', name: 'Offline demo (synthetic)', url: '' },
  ];
  // Alert / DIA overlay. Two sources over the SAME AlertSet shape (so the overlay
  // renderer, hit-test, and time slider are identical): a synthetic demo set
  // (generated lazily) and the real, auth-gated Rubin DP1 DIASource table.
  let showAlerts = $state(false);
  let alertSource = $state<'synthetic' | 'live'>('synthetic');
  let alertLoading = $state(false);
  let alerts: AlertSet | null = $state(null);
  let alertIndex: AlertIndex | null = $state(null);
  let alertTypeMask = $state(allTypesMask());
  const ALERT_SYNTHETIC_COUNT = 200000;
  // Alert time-window filter (MJD). Bounds come from the loaded set; the window
  // starts full-open. Null until alerts load.
  let alertMjdBounds = $state<[number, number] | null>(null);
  let alertWindowMin = $state(0);
  let alertWindowMax = $state(0);
  const alertTimeWindow = $derived(
    alertMjdBounds && (alertWindowMin > alertMjdBounds[0] || alertWindowMax < alertMjdBounds[1])
      ? { min: alertWindowMin, max: alertWindowMax }
      : null
  );
  const alertWindowCount = $derived(
    alerts && alertTimeWindow ? alertsInWindow(alerts, alertTimeWindow.min, alertTimeWindow.max).count : (alerts?.count ?? 0)
  );
  // Nearest alert under the cursor (for the hover inspector).
  let alertHover = $state<AlertHit | null>(null);

  /** Adopt an AlertSet: rebuild the spatial index and (integer) MJD window bounds. */
  function applyAlertSet(set: AlertSet) {
    alerts = set;
    alertIndex = buildAlertIndex(set);
    const [lo, hi] = alertTimeRange(set);
    // Integer MJD bounds so the range sliders (step 1) accept the endpoints.
    const loI = Math.floor(lo);
    const hiI = Math.ceil(hi);
    alertMjdBounds = set.count > 0 ? [loI, hiI] : null;
    alertWindowMin = loI;
    alertWindowMax = hiI;
  }

  function loadSyntheticAlerts() {
    applyAlertSet(generateSyntheticAlerts(ALERT_SYNTHETIC_COUNT, 1));
    statusMessage = `Alerts: ${alerts!.count.toLocaleString()} synthetic events loaded`;
  }

  /** Fetch real Rubin DP1 DIASources near the view centre (auth-gated, honest). */
  async function loadDiaAlerts() {
    if (!authenticated) {
      statusMessage = 'Live DIA needs an RSP token — sign in, or use the synthetic demo.';
      return;
    }
    alertLoading = true;
    // Push the epoch window into the QUERY (server-side) when the user has
    // narrowed the time slider, so a truncated field can be fetched COMPLETELY
    // one slice at a time instead of client-filtering an arbitrary capped subset.
    const win = alertTimeWindow;
    const windowNote = win ? ` in MJD ${win.min.toFixed(0)}–${win.max.toFixed(0)}` : '';
    statusMessage = `Fetching Rubin DIASources near ${currentRa.toFixed(2)}, ${currentDec.toFixed(2)}${windowNote}…`;
    try {
      // ~1° radius ≈ a DP1 field; DP1 has no DIA outside its few small fields.
      const set = await fetchDiaAlerts({
        ra: currentRa,
        dec: currentDec,
        radiusDeg: 1.0,
        tMinMjd: win?.min,
        tMaxMjd: win?.max,
      });
      applyAlertSet(set);
      statusMessage =
        set.count === 0
          ? `No DIA sources in this field${windowNote} (DP1 covers only a few small fields — try a DP1 field).`
          : set.truncated
            ? `Live DIA: showing ${set.count.toLocaleString()}${windowNote} — TRUNCATED (the field has more; narrow the epoch window and Refresh, or zoom in).`
            : `Live DIA: ${set.count.toLocaleString()} DIASources near the view centre${windowNote}`;
    } catch (e) {
      statusMessage = e instanceof Error ? e.message : 'DIA fetch failed.';
    } finally {
      alertLoading = false;
    }
  }

  function loadAlerts() {
    if (alertSource === 'live') void loadDiaAlerts();
    else loadSyntheticAlerts();
  }

  function toggleAlerts() {
    showAlerts = !showAlerts;
    if (showAlerts && !alerts) loadAlerts();
    else statusMessage = showAlerts ? 'Alerts: on' : 'Alerts: off';
  }

  /** Switch alert source → drop the current set and (re)load from the new source. */
  function handleAlertSourceChange() {
    alerts = null;
    alertIndex = null;
    alertMjdBounds = null;
    if (showAlerts) loadAlerts();
  }

  function toggleAlertType(t: number) {
    alertTypeMask = alertTypeMask ^ (1 << t);
  }

  // Right-click "what's here?" → public SIMBAD cone lookup (no auth). Independent
  // of the bundled-catalog click-identify below.
  let simbadQuery = $state<{ ra: number; dec: number } | null>(null);
  let simbadResults = $state<SimbadObject[] | null>(null);
  let simbadStatus = $state<string | null>(null);
  async function handleSkyContext(ra: number, dec: number) {
    simbadQuery = { ra, dec };
    simbadResults = null;
    simbadStatus = 'Querying SIMBAD…';
    statusMessage = `SIMBAD: what's near ${ra.toFixed(3)}, ${dec.toFixed(3)}?`;
    try {
      // ~1′ cone — tight enough to name the object under the cursor.
      const found = await objectsNear({ ra, dec, radiusArcsec: 60, maxRows: 12 });
      simbadResults = found;
      simbadStatus = found.length ? null : 'No catalogued SIMBAD object within 1′.';
      statusMessage = found.length
        ? `SIMBAD: ${found.length} object(s) — nearest ${found[0]!.mainId} (${found[0]!.objectType})`
        : 'SIMBAD: nothing catalogued within 1′ here';
    } catch (e) {
      simbadStatus = e instanceof Error ? e.message : 'SIMBAD query failed.';
    }
  }
  function handleSimbadSelect(o: SimbadObject) {
    handleSearch(o.ra, o.dec);
  }

  // Click-to-identify object info panel
  let identifyInfo = $state<IdentifyInfo | null>(null);
  // Image-INFERRED classification of the pixels under the click (feature 123),
  // shown as a separate block beside the catalog match. Null = unavailable here.
  let imageClass = $state<ImageClassification | null>(null);
  function handleIdentify(info: IdentifyInfo) {
    identifyInfo = info;
    statusMessage = info.match
      ? `Identified: ${info.match.object.name} (${info.match.object.type}, mag ${info.match.object.magnitude.toFixed(1)})`
      : `No catalogued object within ${(info.matchRadiusDeg * 60).toFixed(0)}′ of the click`;
  }
  function handleClassify(result: ImageClassification | null) {
    imageClass = result;
  }

  // Cross-section / line-profile tool
  let crossSectionMode = $state(false);
  let crossSectionProfile = $state<LineProfile | null>(null);
  function toggleCrossSection() {
    crossSectionMode = !crossSectionMode;
    if (crossSectionMode) { rulerMode = false; regionMode = false; } // all steal the pointer
    statusMessage = crossSectionMode
      ? 'Cross-section: drag a line across the image to profile intensity'
      : 'Cross-section: off';
  }

  // Curved coordinate graticule + compass + scale bar overlay, in a selectable
  // coordinate system.
  let showGraticule = $state(false);
  let gridSystem = $state<'equatorial' | 'galactic' | 'ecliptic'>('equatorial');
  function toggleGraticule() {
    showGraticule = !showGraticule;
    statusMessage = showGraticule ? `Coordinate grid: on (${gridSystem})` : 'Coordinate grid: off';
  }

  // Rubin DP1 footprint coverage overlay — shade the 7 fields so it's obvious
  // WHERE Rubin data exists (a view off every field falls back to DSS/black).
  let showCoverage = $state(false);
  function toggleCoverage() {
    showCoverage = !showCoverage;
    statusMessage = showCoverage
      ? 'DP1 coverage: showing the 7 Rubin fields (~15 deg² total) — data exists only inside these'
      : 'DP1 coverage: off';
  }

  // Offline image differencing (epoch A vs B → transients) over the synthetic cube.
  const DIFF_ORDER = 6; // browsing order where the wide-beam synthetic sources show
  let diffMode = $state(false);
  let diffAIndex = $state(0);
  let diffBIndex = $state(0);
  // The HEALPix tile at the current view centre (recomputed as you pan).
  const diffPix = $derived(radecToTileIndex(currentRa, currentDec, DIFF_ORDER));
  function toggleDiff() {
    diffMode = !diffMode;
    if (diffMode) {
      // Default the two epochs to the brightest transient's faint vs bright epoch,
      // and jump to it so the differenced tile actually contains the event.
      const t = brightestOfflineVariable(offlineBand);
      diffAIndex = t.faintEpochIndex;
      diffBIndex = t.brightEpochIndex;
      currentRa = t.ra;
      currentDec = t.dec;
      imageViewerRef?.panTo(t.ra, t.dec);
      imageViewerRef?.setZoom(7);
      statusMessage = 'Differencing: faint vs bright epoch of the synthetic transient';
    } else {
      statusMessage = 'Differencing: off';
    }
  }

  // Variability map (feature 124 display): per-pixel temporal variability across
  // ALL offline epochs for the tile at the view centre, over the pure variability.ts
  // pipeline. Offline-only (a single Rubin coadd has no time axis).
  let varMode = $state(false);
  function toggleVariability() {
    varMode = !varMode;
    if (varMode) {
      // Jump to the brightest transient so the tile actually contains variability.
      const t = brightestOfflineVariable(offlineBand);
      currentRa = t.ra;
      currentDec = t.dec;
      imageViewerRef?.panTo(t.ra, t.dec);
      imageViewerRef?.setZoom(7);
      statusMessage = 'Variability: per-pixel temporal σ across all synthetic epochs';
    } else {
      statusMessage = 'Variability: off';
    }
  }

  // FITS cutout (feature 109): fetch a real DP1 SODA image cutout at the view
  // centre and display honest linear-float pixels with a calibrated WCS readout.
  // Auth-gated (cutouts REQUIRE an RSP token with DP1 rights) — the offline / no-
  // token path surfaces the thrown error VERBATIM, never a blank/black panel.
  const CUTOUT_SIZE_ARCSEC = 30;
  let cutoutOpen = $state(false);
  let cutoutStatus = $state<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  let cutoutImage = $state<FitsImage | null>(null);
  let cutoutError = $state<string | null>(null);
  let cutoutMeta = $state<{ ra: number; dec: number; band: string; datasetId: string } | null>(null);

  // The single ugrizy band to cut: an explicit single-band Rubin dataset picks
  // that band; in the offline cube use its band; otherwise default to r (the
  // deep-coadd reference band). Always a valid ugrizy band for the SODA discovery.
  const cutoutBand = $derived(
    rubinDataset.startsWith('band_')
      ? rubinDataset.slice('band_'.length)
      : baseLayerId === 'offline'
        ? offlineBand
        : 'r'
  );

  async function fetchCutout() {
    cutoutStatus = 'loading';
    cutoutError = null;
    cutoutImage = null;
    const ra = currentRa;
    const dec = currentDec;
    const band = cutoutBand;
    statusMessage = `Fetching FITS cutout at ${ra.toFixed(3)}, ${dec.toFixed(3)} (band ${band})…`;
    try {
      const { fits, id } = await fetchCutoutAt({ ra, dec, sizeArcsec: CUTOUT_SIZE_ARCSEC, band });
      // DP1 cutouts are tile-compressed multi-extension FITS (GZIP_2), so the
      // async tile-aware reader is required (plain readFits throws "NAXIS=0").
      const parsed = await readFitsImageAsync(fits);
      cutoutImage = parsed;
      cutoutMeta = { ra, dec, band, datasetId: id };
      cutoutStatus = 'loaded';
      statusMessage = `FITS cutout: ${parsed.width}×${parsed.height} px from ${id}`;
    } catch (e) {
      // Surface the thrown message VERBATIM (e.g. "requires sign-in", "No DP1
      // image covers this position") — never a silent/blank failure.
      cutoutError = e instanceof Error ? e.message : String(e);
      cutoutStatus = 'error';
      statusMessage = `Cutout: ${cutoutError}`;
    }
  }

  function toggleCutout() {
    cutoutOpen = !cutoutOpen;
    if (cutoutOpen) {
      void fetchCutout();
    } else {
      cutoutStatus = 'idle';
      cutoutImage = null;
      cutoutError = null;
      cutoutMeta = null;
      statusMessage = 'FITS cutout: off';
    }
  }

  // RGB band-mixing composite (feature 120): fetch three per-band DP1 SODA cutouts
  // at the SAME position/size and composite them with the Lupton asinh recipe.
  // Auth-gated like the single-band cutout — offline / no-token surfaces the
  // thrown error VERBATIM, never a fake colour image. Longer wavelength → red.
  const RGB_BANDS = ['i', 'r', 'g'] as const;
  let rgbOpen = $state(false);
  let rgbStatus = $state<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  let rgbImages = $state<Record<string, FitsImage> | null>(null);
  let rgbError = $state<string | null>(null);
  let rgbMeta = $state<{ ra: number; dec: number } | null>(null);

  async function fetchRgb() {
    rgbStatus = 'loading';
    rgbError = null;
    rgbImages = null;
    const ra = currentRa;
    const dec = currentDec;
    statusMessage = `Fetching RGB cutouts (${RGB_BANDS.join(', ')}) at ${ra.toFixed(3)}, ${dec.toFixed(3)}…`;
    try {
      const images: Record<string, FitsImage> = {};
      // Fetch each band's cutout at the identical position/size so they align.
      for (const band of RGB_BANDS) {
        const { fits } = await fetchCutoutAt({ ra, dec, sizeArcsec: CUTOUT_SIZE_ARCSEC, band });
        images[band] = await readFitsImageAsync(fits);
      }
      rgbImages = images;
      rgbMeta = { ra, dec };
      rgbStatus = 'loaded';
      statusMessage = `RGB composite: ${RGB_BANDS.join('/')} cutouts ready`;
    } catch (e) {
      // Surface the thrown message VERBATIM (e.g. "requires sign-in", "No DP1
      // image covers this position") — never a silent/blank/fake failure.
      rgbError = e instanceof Error ? e.message : String(e);
      rgbStatus = 'error';
      statusMessage = `RGB composite: ${rgbError}`;
    }
  }

  function toggleRgb() {
    rgbOpen = !rgbOpen;
    if (rgbOpen) {
      void fetchRgb();
    } else {
      rgbStatus = 'idle';
      rgbImages = null;
      rgbError = null;
      rgbMeta = null;
      statusMessage = 'RGB composite: off';
    }
  }

  // Gaia catalog overlay + linked table + colour–magnitude diagram (public ESA
  // Gaia TAP — no RSP token). `gaiaRaw` keeps the rich columnar catalog (BP−RP,
  // parallax, PM) so the CMD can plot real data; `catalog` is the overlay/table
  // adapter. Their indices are 1:1, so one `selectedCatalogIndex` links the sky
  // marker, the table row, AND the CMD point.
  let showCatalog = $state(false);
  let catalog = $state<CatalogSet | null>(null);
  let gaiaRaw = $state<GaiaCatalog | null>(null);
  let catalogStatus = $state<string | null>(null);
  let catalogLoading = $state(false);
  let selectedCatalogIndex = $state(-1);
  // Proper-motion arrows on the Gaia markers (default off — off by default so the
  // overlay stays uncluttered until the user asks for the vectors).
  let showPmVectors = $state(false);

  async function loadGaiaCatalog() {
    catalogLoading = true;
    catalog = null;
    gaiaRaw = null;
    selectedCatalogIndex = -1;
    catalogStatus = `Querying Gaia DR3 near ${currentRa.toFixed(3)}, ${currentDec.toFixed(3)}…`;
    try {
      const cat = await fetchGaiaCone({ ra: currentRa, dec: currentDec, radiusDeg: 0.2, maxRows: 2000 });
      gaiaRaw = cat;
      catalog = gaiaToCatalogSet(cat);
      catalogStatus = catalog.count > 0 ? null : 'No Gaia sources in this 12′ cone.';
      statusMessage = `Gaia DR3: ${catalog.count.toLocaleString()} sources near the view centre`;
    } catch (e) {
      catalogStatus = e instanceof Error ? e.message : 'Gaia query failed.';
    } finally {
      catalogLoading = false;
    }
  }
  function toggleCatalog() {
    showCatalog = !showCatalog;
    if (showCatalog && !catalog) void loadGaiaCatalog();
    statusMessage = showCatalog ? 'Gaia catalog: on' : 'Gaia catalog: off';
  }
  function togglePmVectors() {
    showPmVectors = !showPmVectors;
    statusMessage = showPmVectors
      ? 'Gaia proper-motion vectors: on (arrow = μα*, μδ direction)'
      : 'Gaia proper-motion vectors: off';
  }
  function handleCatalogSelect(i: number) {
    if (!catalog || i < 0 || i >= catalog.count) return;
    selectedCatalogIndex = i;
    const ra = catalog.ra[i]!;
    const dec = catalog.dec[i]!;
    currentRa = ra;
    currentDec = dec;
    imageViewerRef?.panTo(ra, dec);
    statusMessage = `Gaia: ${catalog.label[i]} at ${ra.toFixed(4)}, ${dec.toFixed(4)}`;
  }

  // Gravitational-lens overlay + linked table (feature 130). A bundled, curated
  // set of ~19 web-verified strong lenses — an INDEPENDENT layer from the Gaia
  // overlay above (both can be on at once; neither wipes the other). Clicking a
  // lens row recenters the view and reports its name / type / redshift.
  let showLenses = $state(false);
  let lensCatalog = $state<CatalogSet | null>(null);
  let selectedLensIndex = $state(-1);
  function toggleLenses() {
    showLenses = !showLenses;
    if (showLenses && !lensCatalog) lensCatalog = lensCatalogSet();
    statusMessage = showLenses
      ? `Gravitational lenses: ${lensCatalog!.count} known strong lenses overlaid`
      : 'Gravitational lenses: off';
  }
  function handleLensSelect(i: number) {
    if (!lensCatalog || i < 0 || i >= lensCatalog.count) return;
    selectedLensIndex = i;
    const ra = lensCatalog.ra[i]!;
    const dec = lensCatalog.dec[i]!;
    currentRa = ra;
    currentDec = dec;
    imageViewerRef?.panTo(ra, dec);
    const rec = lensCatalog.records[i]!;
    statusMessage = `Lens: ${rec['Name']} — ${rec['Type']} · z_lens ${rec['z_lens']} · z_source ${rec['z_source']}`;
  }

  // Rubin DP1 Object catalog overlay + linked table (feature 128). The token-gated
  // sibling of the Gaia overlay above: a LIVE cone search of dp1.Object via TAP,
  // available only when a Rubin base is active AND the session is authenticated
  // (fetchRubinObjects throws an honest sign-in error otherwise). An INDEPENDENT
  // layer — it can be shown alongside Gaia/lenses without wiping them. Clicking a
  // row recenters the view and links the marker.
  let showRubinObjects = $state(false);
  let rubinCatalog = $state<CatalogSet | null>(null);
  let rubinObjStatus = $state<string | null>(null);
  let rubinObjLoading = $state(false);
  let selectedRubinIndex = $state(-1);

  async function loadRubinObjects() {
    rubinObjLoading = true;
    rubinCatalog = null;
    selectedRubinIndex = -1;
    rubinObjStatus = `Querying Rubin DP1 Objects near ${currentRa.toFixed(3)}, ${currentDec.toFixed(3)}…`;
    try {
      const set = await fetchRubinObjects({
        ra: currentRa,
        dec: currentDec,
        radiusDeg: RUBIN_OBJECT_DEFAULT_RADIUS_DEG,
        maxRows: 2000,
      });
      rubinCatalog = set;
      rubinObjStatus =
        set.count > 0
          ? null
          : 'No Rubin DP1 Objects in this cone (DP1 covers only a few small fields — try a DP1 field centre).';
      statusMessage = `Rubin DP1 Object: ${set.count.toLocaleString()} objects near the view centre`;
    } catch (e) {
      rubinObjStatus = e instanceof Error ? e.message : 'Rubin Object query failed.';
    } finally {
      rubinObjLoading = false;
    }
  }

  function toggleRubinObjects() {
    showRubinObjects = !showRubinObjects;
    if (!showRubinObjects) {
      statusMessage = 'Rubin DP1 Object catalog: off';
      return;
    }
    // Prerequisites: a Rubin base must be active AND the session authenticated.
    // Surface the missing prerequisite instead of the toggle silently doing
    // nothing (mirrors the light-curve toggle's explain-the-prerequisite behaviour).
    if (!rubinActive || !authenticated) {
      rubinCatalog = null;
      selectedRubinIndex = -1;
      const why = !rubinActive
        ? 'switch the base layer to Rubin (DP1) — the Object catalog is DP1 data'
        : 'sign in with an RSP token that has DP1 data rights';
      rubinObjStatus = `No Rubin Object source — ${why}.`;
      statusMessage = `Rubin DP1 Object: no source — ${why}.`;
      return;
    }
    if (!rubinCatalog) void loadRubinObjects();
    statusMessage = 'Rubin DP1 Object catalog: on';
  }

  function handleRubinSelect(i: number) {
    if (!rubinCatalog || i < 0 || i >= rubinCatalog.count) return;
    selectedRubinIndex = i;
    const ra = rubinCatalog.ra[i]!;
    const dec = rubinCatalog.dec[i]!;
    currentRa = ra;
    currentDec = dec;
    imageViewerRef?.panTo(ra, dec);
    statusMessage = `Rubin Object ${rubinCatalog.label[i]} at ${ra.toFixed(4)}, ${dec.toFixed(4)}`;
  }

  // Magnifier loupe of the pixels under the cursor.
  let showMagnifier = $state(false);
  function toggleMagnifier() {
    showMagnifier = !showMagnifier;
    statusMessage = showMagnifier ? 'Magnifier: on — move the cursor over the image' : 'Magnifier: off';
  }

  // Performance HUD (default OFF): live FPS / render / cache-hit-rate / in-flight
  // fetches driven by ImageViewer's real fetch + render path.
  let showPerfHud = $state(false);
  let perfSnapshot = $state<PerfSnapshot | null>(null);
  function togglePerfHud() {
    showPerfHud = !showPerfHud;
    statusMessage = showPerfHud ? 'Performance HUD: on' : 'Performance HUD: off';
  }

  // Distance ruler: drag between two sky points → great-circle separation + PA.
  let rulerMode = $state(false);
  let rulerReadout = $state<string | null>(null);
  function toggleRuler() {
    rulerMode = !rulerMode;
    if (rulerMode) { crossSectionMode = false; regionMode = false; } // all steal the pointer
    if (!rulerMode) rulerReadout = null;
    statusMessage = rulerMode
      ? 'Ruler: drag between two points to measure great-circle distance'
      : 'Ruler: off';
  }
  function handleRulerChange(m: { separationDeg: number; paDeg: number; text: string } | null) {
    rulerReadout = m?.text ?? null;
    if (m) statusMessage = `Distance: ${m.text}`;
  }

  // DS9 regions (feature 121): draw / import / export circles, polygons, etc.
  // Sky regions are stored in ICRS degrees and reprojected by ImageViewer.
  let regions = $state<Ds9Region[]>([]);
  let regionMode = $state(false);
  let regionShape = $state<'circle' | 'polygon'>('circle');
  let regionImportOpen = $state(false);
  let regionImportText = $state('');
  let regionImportMessage = $state<string | null>(null);
  let regionFileInput: HTMLInputElement | undefined;
  const REGION_IMPORT_PLACEHOLDER = '# Region file format: DS9\nfk5\ncircle(202.47,47.20,30")';

  function toggleRegionMode() {
    regionMode = !regionMode;
    if (regionMode) {
      // Region drawing steals the pointer, so it can't coexist with the other
      // pointer-stealing tools.
      rulerMode = false;
      crossSectionMode = false;
      surfaceMode = false;
    }
    statusMessage = regionMode
      ? regionShape === 'circle'
        ? 'Regions: drag to draw a circle'
        : 'Regions: click to add polygon vertices; click the first vertex (or Esc) to finish'
      : 'Regions: draw off';
  }

  function setRegionShape(shape: 'circle' | 'polygon') {
    regionShape = shape;
    if (regionMode) {
      statusMessage =
        shape === 'circle'
          ? 'Regions: drag to draw a circle'
          : 'Regions: click to add polygon vertices; click the first vertex (or Esc) to finish';
    }
  }

  function handleRegionsChange(next: Ds9Region[]) {
    regions = next;
    statusMessage = `Regions: ${next.length} region${next.length === 1 ? '' : 's'}`;
  }

  function clearRegions() {
    regions = [];
    statusMessage = 'Regions: cleared';
  }

  /** Serialize the current regions to a DS9 .reg file and trigger a download. */
  function exportRegions() {
    if (regions.length === 0) {
      statusMessage = 'Regions: nothing to export — draw or import a region first';
      return;
    }
    const text = serializeDs9(regions);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'regions.reg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusMessage = `Regions: exported ${regions.length} region${regions.length === 1 ? '' : 's'} to regions.reg`;
  }

  /** Parse pasted / uploaded DS9 text and add the regions. Honest about junk:
   *  a message, never a crash and never a silent no-op. */
  function importRegions(text: string) {
    let parsed: Ds9Region[];
    try {
      parsed = parseDs9(text);
    } catch {
      // parseDs9 is designed never to throw, but stay defensive at the boundary.
      regionImportMessage = 'Could not parse that as a DS9 region file.';
      return;
    }
    if (parsed.length === 0) {
      regionImportMessage =
        'No recognizable DS9 regions found (need e.g. a fk5/icrs circle or polygon).';
      return;
    }
    regions = [...regions, ...parsed];
    regionImportMessage = `Imported ${parsed.length} region${parsed.length === 1 ? '' : 's'}.`;
    statusMessage = `Regions: imported ${parsed.length}`;
    regionImportText = '';
    regionImportOpen = false;
  }

  function importFromTextarea() {
    importRegions(regionImportText);
  }

  function handleRegionFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importRegions(String(reader.result ?? ''));
    reader.onerror = () => { regionImportMessage = 'Could not read that file.'; };
    reader.readAsText(file);
    input.value = ''; // allow re-selecting the same file
  }

  // 3D surface plot — a TEMPORAL WATERFALL of the cross-section line: column =
  // position along the drawn line, row = epoch (row 0 = earliest, at back → latest
  // in front), height = intensity. This is meaningful only over the OFFLINE
  // synthetic multi-epoch cube (DP1's HiPS is a single deep coadd — no time axis),
  // so it draws only when the offline base is active AND a cross-section line has
  // been drawn AND there are ≥2 epochs; otherwise it shows an honest prompt.
  const SURFACE_SAMPLES = 48; // columns (positions) along the line for the waterfall
  let surfaceMode = $state(false);
  // Height grid[epoch][position] sampled by re-walking the CURRENT cross-section
  // line across every offline epoch, using the synthetic sky's ground-truth
  // per-point light curve (offlineLightCurve → intensityAt). Null → honest empty
  // state (never the old spatial relief, never a fabricated surface).
  const surfaceGrid = $derived.by((): number[][] | null => {
    if (!surfaceMode || baseLayerId !== 'offline') return null;
    const ep = crossSectionProfile?.endpoints;
    if (!ep || OFFLINE_EPOCHS.length < 2) return null;
    const lcCache = new Map<number, LightCurvePoint[]>();
    return temporalCrossSectionGrid(
      ep,
      OFFLINE_EPOCHS.length,
      SURFACE_SAMPLES,
      (ra, dec, epochIndex, sampleIndex) => {
        // One light curve per column (position), reused across every epoch row.
        let lc = lcCache.get(sampleIndex);
        if (!lc) {
          lc = offlineLightCurve(ra, dec, offlineBand);
          lcCache.set(sampleIndex, lc);
        }
        return lc[epochIndex]?.intensity ?? NaN;
      },
    );
  });
  // Honest empty-state prompt, reasoned by WHY there's nothing to plot.
  const surfaceEmptyMessage = $derived(
    baseLayerId !== 'offline'
      ? 'Switch to the Offline demo layer — only it has multiple epochs to show time evolution.'
      : crossSectionProfile?.endpoints
        ? 'Sampling the cross-section line over epochs…'
        : 'Draw a cross-section line over the offline multi-epoch layer to see its time evolution.'
  );
  function toggleSurface() {
    surfaceMode = !surfaceMode;
    if (surfaceMode) {
      rulerMode = false;
      regionMode = false;
      // The surface IS the cross-section over time, so it needs a line: enable the
      // cross-section tool (which seeds a default line) when offline.
      if (baseLayerId === 'offline') crossSectionMode = true;
    }
    statusMessage = surfaceMode
      ? baseLayerId === 'offline'
        ? '3D surface: cross-section line intensity over epochs (waterfall) — drag the line to reprofile it over time'
        : '3D surface: draw a cross-section line over the OFFLINE multi-epoch layer to see time evolution'
      : '3D surface: off';
  }

  // Light curve (intensity vs time). OFFLINE: from the known synthetic light curves
  // at the view centre (recomputes as you pan). RUBIN: real DP1 forced-photometry
  // fetched on demand via TAP (auth-gated; DP1 covers only a few small fields, so
  // most positions legitimately return no epochs).
  let lightCurveMode = $state(false);
  const offlineLc = $derived(
    lightCurveMode && baseLayerId === 'offline'
      ? offlineLightCurve(currentRa, currentDec, offlineBand)
      : null
  );
  // Rubin light curve is available when a Rubin base is active AND authenticated.
  const rubinLcAvailable = $derived(rubinActive && authenticated);
  let rubinLcCurve = $state<LightCurvePoint[] | null>(null);
  let rubinLcStatus = $state<string | null>(null);

  async function fetchRubinLc() {
    rubinLcCurve = null;
    rubinLcStatus = `Fetching DP1 light curve at ${currentRa.toFixed(3)}, ${currentDec.toFixed(3)}…`;
    try {
      const parsed = await fetchLightCurve({ ra: currentRa, dec: currentDec, radiusArcsec: 2 });
      const pts = toLightCurvePoints(parsed, { band: 'r' });
      if (pts.length === 0) {
        rubinLcStatus = 'No DP1 epochs here (DP1 covers only a few small fields — try an on-field source).';
      } else {
        rubinLcCurve = pts;
        rubinLcStatus = null;
        statusMessage = `Rubin light curve: ${pts.length} r-band epochs`;
      }
    } catch (e) {
      rubinLcStatus = e instanceof Error ? e.message : 'Light-curve fetch failed.';
    }
  }

  function toggleLightCurve() {
    lightCurveMode = !lightCurveMode;
    if (lightCurveMode && baseLayerId !== 'offline' && !rubinLcAvailable) {
      // Without the offline cube or an authenticated Rubin base there is no
      // epoch source, so the toggle would otherwise silently "do nothing".
      // Tell the user the prerequisite instead of leaving an empty panel.
      const why = !rubinActive
        ? 'switch the base layer to Rubin (DP1) or the Offline demo'
        : 'sign in with an RSP token that has DP1 data rights';
      rubinLcCurve = null;
      rubinLcStatus = `No light-curve source — ${why}.`;
      statusMessage = `Light curve: no source — ${why}.`;
      return;
    }
    if (lightCurveMode && baseLayerId !== 'offline' && rubinLcAvailable) {
      void fetchRubinLc();
    }
    statusMessage = lightCurveMode ? 'Light curve: on' : 'Light curve: off';
  }

  // Gaia DR2 variable-star light curve (public GAVO epoch photometry, NO auth) —
  // works on any base. Only ~550k DR2 variables exist, so most positions have none.
  let gaiaLcMode = $state(false);
  let gaiaLcCurve = $state<LightCurvePoint[] | null>(null);
  let gaiaLcStatus = $state<string | null>(null);
  let gaiaLcSourceId = $state<string | null>(null);
  async function fetchGaiaLc() {
    gaiaLcCurve = null;
    gaiaLcSourceId = null;
    gaiaLcStatus = `Searching Gaia DR2 variables at ${currentRa.toFixed(3)}, ${currentDec.toFixed(3)}…`;
    try {
      const vars = await fetchGaiaLightCurves({ ra: currentRa, dec: currentDec, radiusArcsec: 6 });
      const withG = vars.filter((v) => v.g.length >= 2);
      if (withG.length === 0) {
        gaiaLcStatus =
          'No Gaia DR2 variable here (only ~550k published variables have epoch photometry — try a known variable star).';
        return;
      }
      const v = withG[0]!;
      gaiaLcSourceId = v.sourceId;
      gaiaLcCurve = v.g.map((p) => ({ mjd: p.mjd, intensity: p.intensity }));
      gaiaLcStatus = null;
    } catch (e) {
      gaiaLcStatus = e instanceof Error ? e.message : 'Gaia light-curve fetch failed.';
    }
  }
  function toggleGaiaLc() {
    gaiaLcMode = !gaiaLcMode;
    if (gaiaLcMode) void fetchGaiaLc();
    statusMessage = gaiaLcMode ? 'Gaia variable light curve: on' : 'Gaia variable light curve: off';
  }

  // Rubin DP1 multi-filter: switch the active HiPS dataset (gri/ugri/… colour
  // composites or a single ugrizy band). Shown when the Rubin base is active.
  let rubinDataset = $state(seed.rubinDataset ?? 'color_gri');

  // The datasets offered in the Filter dropdown (TODO 129). Seeded with the
  // hardcoded fallback so the dropdown is populated INSTANTLY, then replaced by
  // the set discovered from the DP1 HiPS list endpoint once the Rubin base first
  // becomes active. Discovery failure (network/CORS/404/malformed) leaves the
  // fallback in place — the dropdown always works, never empties, never crashes.
  let rubinDatasets = $state<readonly RubinDataset[]>(RUBIN_DATASETS);
  let datasetsDiscovered = $state(false);

  // Offline synthetic cube browsing: independent time (epoch) and wavelength
  // (band) axes. Only meaningful while the offline base layer is active; drive
  // ImageViewer to re-synthesize tiles per (band, mjd).
  let offlineBand = $state<Band>((seed.offlineBand as Band) ?? 'r');
  let offlineEpochIndex = $state(
    Math.max(0, Math.min(OFFLINE_EPOCHS.length - 1, seed.offlineEpoch ?? 0))
  );
  let offlineBlinkPlaying = $state(false);
  const offlineMjd = $derived(OFFLINE_EPOCHS[offlineEpochIndex] ?? OFFLINE_EPOCHS[0] ?? 60000);

  let baseLayerId = $state<'auto' | 'dss' | 'rubin' | 'offline'>(seed.base ?? 'auto');
  // Name of the DP1 field most recently jumped to (shown as a chip).
  let currentFieldName = $state<string | null>(null);
  const baseLayer = $derived(BASE_LAYERS.find((b) => b.id === baseLayerId) ?? BASE_LAYERS[0]);
  // The label of the base survey ImageViewer ACTUALLY resolved (reflects a silent
  // Auto→DSS2 fallback), reported via onBaseResolved. Not the nominal selection.
  let resolvedBaseLabel = $state('DSS2 Color');
  const activeBaseName = $derived(
    baseLayerId === 'auto' ? resolvedBaseLabel : baseLayer.name
  );
  // Whether the Rubin DP1 base is actually active (explicit, or auto-resolved to
  // Rubin and not fallen back) — gates the multi-filter dataset selector.
  const rubinActive = $derived(
    baseLayerId === 'rubin' || (baseLayerId === 'auto' && resolvedBaseLabel.startsWith('Rubin'))
  );

  // TODO 129: when the Rubin base first becomes active, replace the hardcoded
  // fallback list with the datasets discovered from the DP1 HiPS list endpoint.
  // Runs at most once; any failure leaves the fallback list untouched.
  $effect(() => {
    if (!rubinActive || datasetsDiscovered) return;
    datasetsDiscovered = true;
    void fetchDp1Datasets().then((discovered) => {
      if (discovered.length > 0) rubinDatasets = discovered;
    });
  });

  // NOTE: the old SidePanel epoch/blink controls were driven by MOCK epochs
  // (constants.DEFAULT_MOCK_EPOCHS) that never changed the imagery — a dead
  // placeholder. Real multi-epoch browsing lives in the OFFLINE cube
  // (OfflineLayerControls) and the Rubin DP1 light curve, so those mock controls
  // are removed rather than wired to fake data.

  let imageViewerRef: ImageViewer | undefined = $state();
  let rspToken = $state(getToken() || '');
  let authenticated = $state(isAuthenticated());

  /** Handle token changes from the TokenDialog: update the token passed to
   *  ImageViewer (which switches between public DSS and Rubin base URLs) and
   *  refresh the authenticated flag used by the toolbar. */
  function handleTokenChange(token: string | null) {
    rspToken = token ?? '';
    authenticated = isAuthenticated();
    statusMessage = authenticated
      ? 'Authenticated with Rubin Science Platform'
      : 'Logged out — using public preview imagery (DSS)';
  }

  function handleStretchChange(v: {
    blackPoint: number;
    whitePoint: number;
    contrast: number;
    bias: number;
  }) {
    blackPoint = v.blackPoint;
    whitePoint = v.whitePoint;
    contrast = v.contrast;
    bias = v.bias;
    statusMessage = `Stretch: bp ${v.blackPoint.toFixed(2)} wp ${v.whitePoint.toFixed(2)} contrast ${v.contrast.toFixed(2)} bias ${v.bias.toFixed(2)}`;
  }

  function handleViewerStateChange(state: ViewerState) {
    currentRa = state.centerRa;
    currentDec = state.centerDec;
    zoomLevel = state.zoomLevel;
  }

  function handleSearch(ra: number, dec: number) {
    currentRa = ra;
    currentDec = dec;
    imageViewerRef?.panToAndReload(ra, dec);
    // An explicit go-to may land on Rubin coverage — clear a prior auto→DSS
    // fallback so Auto re-attempts Rubin at the new position.
    imageViewerRef?.retryBase();
    statusMessage = `Go to RA=${ra.toFixed(2)}°, Dec=${dec.toFixed(2)}°`;
  }

  /** Navigate to a DP1 field centre (see src/data/dp1Fields.ts). */
  function gotoDp1Field(id: string) {
    const f = DP1_FIELDS.find((x) => x.id === id);
    if (!f) return;
    // If the user is on DSS/offline, switch to Auto so an authenticated session
    // resolves to Rubin over the field (Auto → Rubin when a token is present).
    if (baseLayerId === 'dss' || baseLayerId === 'offline') baseLayerId = 'auto';
    currentFieldName = f.name;
    handleSearch(f.ra, f.dec);
    // Frame the ~1 deg² field: at the default 22.5° browse FOV the field is a
    // <1%-of-frame speck (the user sees only black sky off-coverage). Zoom in so
    // the Rubin imagery actually fills the view.
    imageViewerRef?.setZoom(fovToZoom(DP1_FIELD_VIEW_FOV_DEG));
    zoomLevel = fovToZoom(DP1_FIELD_VIEW_FOV_DEG);
    statusMessage = authenticated
      ? `DP1 field: ${f.name} — RA ${f.ra}°, Dec ${f.dec}°`
      : `DP1 field: ${f.name} (sign in with an RSP token to see Rubin data here)`;
  }

  // --- Permalink: reflect the shareable view state into the URL hash ---
  // Debounced (300ms) so continuous pan/zoom updates the hash in place
  // (history.replaceState — no back-button spam) without writing every frame.
  $effect(() => {
    const s = {
      ra: currentRa,
      dec: currentDec,
      zoom: zoomLevel,
      base: baseLayerId,
      rubinDataset,
      scaling,
      colorMap,
      invert,
      overlays: surveyOverlays.map((o) => o.survey.id),
      offlineBand,
      offlineEpoch: offlineEpochIndex,
    };
    const t = setTimeout(() => applyStateToUrl(s), 300);
    return () => clearTimeout(t);
  });

  onMount(() => {
    // Seed survey overlays from the permalink (needs imageViewerRef → after mount).
    if (seed.overlays && seed.overlays.length) {
      for (const id of seed.overlays) {
        const survey = SURVEY_OVERLAYS.find((sv) => sv.id === id);
        if (survey) handleOverlayAdd(survey);
      }
    }
  });

  function handleFilterChange(filter: FilterBand | null) {
    activeFilter = filter;
    statusMessage = filter ? `Filter: ${filter}` : 'Filter: none';
  }

  function handleCompositeChange(channels: { r: FilterBand | null; g: FilterBand | null; b: FilterBand | null }) {
    compositeChannels = channels;
    const parts = [];
    if (channels.r) parts.push(`R:${channels.r}`);
    if (channels.g) parts.push(`G:${channels.g}`);
    if (channels.b) parts.push(`B:${channels.b}`);
    statusMessage = parts.length > 0 ? `Composite: ${parts.join(' ')}` : 'Composite: cleared';
  }

  function handleOverlayAdd(survey: SurveyInfo) {
    surveyOverlays = [...surveyOverlays, { survey, opacity: 80 }];
    imageViewerRef?.addOverlay(survey.id, survey.hipsUrl, 80);
    statusMessage = `Added overlay: ${survey.name}`;
  }

  function handleOverlayRemove(surveyId: string) {
    const entry = surveyOverlays.find(o => o.survey.id === surveyId);
    surveyOverlays = surveyOverlays.filter(o => o.survey.id !== surveyId);
    imageViewerRef?.removeOverlay(surveyId);
    statusMessage = `Removed overlay: ${entry?.survey.name ?? surveyId}`;
  }

  function handleOpacityChange(surveyId: string, opacity: number) {
    surveyOverlays = surveyOverlays.map(o =>
      o.survey.id === surveyId ? { ...o, opacity } : o
    );
    imageViewerRef?.setOverlayOpacity(surveyId, opacity);
    const entry = surveyOverlays.find(o => o.survey.id === surveyId);
    statusMessage = `${entry?.survey.name ?? surveyId} opacity: ${opacity}%`;
  }


  function togglePanel() {
    panelOpen = !panelOpen;
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      isFullscreen = true;
    } else {
      document.exitFullscreen?.();
      isFullscreen = false;
    }
  }

  function handleFullscreenChange() {
    isFullscreen = !!document.fullscreenElement;
  }

  /** Handle object selection from ObjectBrowser */
  function handleObjectSelect(obj: AstroObject) {
    currentRa = obj.ra;
    currentDec = obj.dec;
    imageViewerRef?.panToAndReload(obj.ra, obj.dec);
    statusMessage = `Go to ${obj.name}: RA=${obj.ra.toFixed(2)}°, Dec=${obj.dec.toFixed(2)}°`;
  }

  /** Handle named object search from toolbar */
  export function handleNameSearch(name: string): boolean {
    const obj = lookupObject(name);
    if (obj) {
      handleObjectSelect(obj);
      return true;
    }
    return false;
  }

  function handleKeydown(e: KeyboardEvent) {
    // Escape toggles UI visibility / closes panel
    if (e.key === 'Escape') {
      if (panelOpen) {
        panelOpen = false;
      } else {
        uiVisible = !uiVisible;
      }
      return;
    }
    // H toggles help
    if (e.key === 'h' || e.key === 'H') {
      if (!e.ctrlKey && !e.metaKey) {
        helpOpen = !helpOpen;
        return;
      }
    }
    // F toggles fullscreen
    if (e.key === 'f' || e.key === 'F') {
      if (!e.ctrlKey && !e.metaKey) {
        toggleFullscreen();
        return;
      }
    }
    // G toggles the coordinate grid
    if (e.key === 'g' || e.key === 'G') {
      if (!e.ctrlKey && !e.metaKey) {
        toggleGraticule();
        return;
      }
    }
    // I toggles invert
    if (e.key === 'i' || e.key === 'I') {
      if (!e.ctrlKey && !e.metaKey) {
        invert = !invert;
        statusMessage = `Invert: ${invert ? 'ON' : 'OFF'}`;
        return;
      }
    }
    // +/- for zoom
    if (e.key === '+' || e.key === '=') {
      imageViewerRef?.zoomIn();
    }
    if (e.key === '-' || e.key === '_') {
      imageViewerRef?.zoomOut();
    }
    if (e.key === '0') {
      imageViewerRef?.resetView();
    }
  }
</script>

<svelte:window
  onkeydown={handleKeydown}
  onfullscreenchange={handleFullscreenChange}
/>

<div class="tile-viewer" class:ui-hidden={!uiVisible}>
  {#if uiVisible}
    <CompactToolbar
      panelOpen={panelOpen}
      {isFullscreen}
      {invert}
      onZoomIn={() => imageViewerRef?.zoomIn()}
      onZoomOut={() => imageViewerRef?.zoomOut()}
      onResetView={() => imageViewerRef?.resetView()}
      onSearch={handleSearch}
      onTogglePanel={togglePanel}
      onToggleFullscreen={toggleFullscreen}
      onToggleHelp={() => { helpOpen = !helpOpen; }}
      onToggleInvert={() => { invert = !invert; statusMessage = `Invert: ${invert ? 'ON' : 'OFF'}`; }}
      onToggleToken={() => { tokenDialogOpen = !tokenDialogOpen; }}
      {authenticated}
    />
  {/if}

  <SidePanel
    open={panelOpen}
    {scaling}
    {colorMap}
    {interpolation}
    {invert}
    {blackPoint}
    {whitePoint}
    {contrast}
    {bias}
    {activeFilter}
    {compositeMode}
    {compositeChannels}
    {surveyOverlays}
    onScalingChange={(s) => { scaling = s; statusMessage = `Scaling: ${s}`; }}
    onColorMapChange={(c) => { colorMap = c; statusMessage = `Color map: ${c}`; }}
    onInterpolationChange={(i) => { interpolation = i; statusMessage = `Interpolation: ${i}`; }}
    onInvertChange={(v) => { invert = v; statusMessage = `Invert: ${v ? 'ON' : 'OFF'}`; }}
    onStretchChange={handleStretchChange}
    onFilterChange={handleFilterChange}
    onCompositeChange={handleCompositeChange}
    onOverlayAdd={handleOverlayAdd}
    onOverlayRemove={handleOverlayRemove}
    onOpacityChange={handleOpacityChange}
    onClose={() => { panelOpen = false; }}
  />

  <div class="viewer-area">
    <ImageViewer
      bind:this={imageViewerRef}
      {rspToken}
      baseMode={baseLayerId}
      {scaling}
      {colorMap}
      {interpolation}
      {invert}
      {blackPoint}
      {whitePoint}
      {contrast}
      {bias}
      {alerts}
      {alertIndex}
      {showAlerts}
      {alertTypeMask}
      {alertTimeWindow}
      onAlertHover={(h) => { alertHover = h; }}
      {crossSectionMode}
      {surfaceMode}
      {showGraticule}
      {gridSystem}
      {showCoverage}
      {showMagnifier}
      catalog={showCatalog ? catalog : null}
      {selectedCatalogIndex}
      {showPmVectors}
      lensCatalog={showLenses ? lensCatalog : null}
      {selectedLensIndex}
      rubinCatalog={showRubinObjects ? rubinCatalog : null}
      {selectedRubinIndex}
      {rulerMode}
      onRulerChange={handleRulerChange}
      {regions}
      {regionMode}
      {regionShape}
      onRegionsChange={handleRegionsChange}
      {rubinDataset}
      {offlineBand}
      {offlineMjd}
      initialRa={currentRa}
      initialDec={currentDec}
      initialZoom={zoomLevel}
      onViewerStateChange={handleViewerStateChange}
      onBaseResolved={(label) => { resolvedBaseLabel = label; }}
      onProfileChange={(p) => { crossSectionProfile = p; }}
      onSurfaceChange={() => { /* superseded: the surface is now the cross-section
        line over epochs (temporal waterfall), derived here from crossSectionProfile
        — not ImageViewer's spatial region grid. */ }}
      onIdentify={handleIdentify}
      onClassify={handleClassify}
      onSkyContext={handleSkyContext}
      onPerfSnapshot={(s) => { if (showPerfHud) perfSnapshot = s; }}
    />

    {#if showPerfHud && perfSnapshot}
      <PerfHud snapshot={perfSnapshot} />
    {/if}

    {#if uiVisible}
      <!-- Active layers: base survey + overlays, always visible -->
      <div class="active-layers" aria-label="Active layers">
        <label class="layer-base">
          <span class="layer-label">Base</span>
          <select bind:value={baseLayerId} aria-label="Base layer">
            {#each BASE_LAYERS as bl (bl.id)}
              <option value={bl.id}>{bl.name}</option>
            {/each}
          </select>
          {#if baseLayerId === 'auto'}
            <span class="base-resolved" aria-label="Resolved base layer">→ {activeBaseName}</span>
          {/if}
        </label>
        <label class="layer-dp1">
          <span class="layer-label" title={GLOSSARY['dp1'].short}>DP1</span>
          <select
            class="dp1-jump"
            aria-label="Jump to DP1 field"
            onchange={(e) => {
              const v = e.currentTarget.value;
              e.currentTarget.selectedIndex = 0; // act as a menu, re-selectable
              if (v) gotoDp1Field(v);
            }}
          >
            <option value="">Jump to field…</option>
            {#each DP1_FIELDS as f (f.id)}
              <option value={f.id}>{f.name}</option>
            {/each}
          </select>
        </label>
        {#if currentFieldName}
          <span class="field-chip" aria-label="Current field">◉ {currentFieldName}</span>
        {/if}
        {#if baseLayerId === 'offline'}
          <OfflineLayerControls
            epochs={OFFLINE_EPOCHS}
            bands={OFFLINE_BANDS}
            epochIndex={offlineEpochIndex}
            band={offlineBand}
            playing={offlineBlinkPlaying}
            onEpochChange={(i) => {
              offlineEpochIndex = i;
              statusMessage = `Offline epoch ${i + 1}/${OFFLINE_EPOCHS.length}: MJD ${offlineMjd.toFixed(0)} (${offlineBand})`;
            }}
            onBandChange={(b) => {
              offlineBand = b;
              statusMessage = `Offline band: ${b} (MJD ${offlineMjd.toFixed(0)})`;
            }}
            onPlayStateChange={(p) => { offlineBlinkPlaying = p; }}
            onFindTransient={() => {
              const t = brightestOfflineVariable(offlineBand);
              offlineEpochIndex = t.brightEpochIndex;
              imageViewerRef?.panTo(t.ra, t.dec);
              imageViewerRef?.setZoom(7);
              currentRa = t.ra;
              currentDec = t.dec;
              statusMessage = `Jumped to synthetic transient at RA ${t.ra.toFixed(2)}°, Dec ${t.dec.toFixed(2)}° — blink epochs to watch it fade`;
            }}
          />
        {/if}
        {#if rubinActive}
          <label class="rubin-filter" aria-label="Rubin filter">
            <span
              class="layer-label"
              title={`${GLOSSARY['coadd'].short} — ${GLOSSARY['color-composite'].short}`}
            >Filter</span>
            <select
              bind:value={rubinDataset}
              aria-label="Rubin DP1 dataset"
              onchange={() => { statusMessage = `Rubin dataset: ${rubinDataset}`; }}
            >
              <optgroup label="Colour composites">
                {#each rubinDatasets.filter((d) => d.kind === 'color') as d (d.id)}
                  <option value={d.id}>{d.label}</option>
                {/each}
              </optgroup>
              <optgroup label="Single band">
                {#each rubinDatasets.filter((d) => d.kind === 'band') as d (d.id)}
                  <option value={d.id}>{d.label}-band</option>
                {/each}
              </optgroup>
            </select>
          </label>
        {/if}
        {#each surveyOverlays as ov (ov.survey.id)}
          <span class="layer-chip">
            {ov.survey.name}
            <button
              class="chip-remove"
              aria-label={`Remove ${ov.survey.name} overlay`}
              onclick={() => handleOverlayRemove(ov.survey.id)}>×</button>
          </span>
        {/each}

        <button
          class="alert-toggle"
          class:on={showAlerts}
          aria-pressed={showAlerts}
          aria-label="Toggle alert overlay"
          title={alertSource === 'live'
            ? 'Real Rubin DP1 DIASources near the view centre (auth-gated)'
            : 'Synthetic demo events — NOT real Rubin alerts'}
          onclick={toggleAlerts}
        >
          ◈ Alerts{#if alerts && showAlerts} ({alertSource === 'live' ? 'DIA' : 'demo'}, {alerts.count.toLocaleString()}){/if}
        </button>

        <button
          class="xsection-toggle"
          class:on={crossSectionMode}
          aria-pressed={crossSectionMode}
          aria-label="Toggle cross-section tool"
          title="Draw a line across the image to plot intensity vs. position (relative luminance)"
          onclick={toggleCrossSection}
        >
          ╱ Cross-section
        </button>

        <button
          class="xsection-toggle"
          class:on={surfaceMode}
          aria-pressed={surfaceMode}
          aria-label="Toggle 3D surface plot"
          title="Show the central region's intensity as a 3D relief / mountain plot"
          onclick={toggleSurface}
        >
          ▲ 3D surface
        </button>

        <button
          class="xsection-toggle"
          class:on={showGraticule}
          aria-pressed={showGraticule}
          aria-label="Toggle coordinate grid"
          title="Curved RA/Dec coordinate grid, N/E compass, and scale bar (key: g)"
          onclick={toggleGraticule}
        >
          ⊞ Grid
        </button>

        {#if showGraticule}
          <label class="rubin-filter" aria-label="Grid coordinate system">
            <span class="layer-label">System</span>
            <select
              bind:value={gridSystem}
              aria-label="Grid coordinate system select"
              onchange={() => { statusMessage = `Coordinate grid: ${gridSystem}`; }}
            >
              <option value="equatorial">Equatorial (RA/Dec)</option>
              <option value="galactic">Galactic (l/b)</option>
              <option value="ecliptic">Ecliptic (λ/β)</option>
            </select>
          </label>
        {/if}

        <button
          class="xsection-toggle"
          class:on={showCoverage}
          aria-pressed={showCoverage}
          aria-label="Toggle DP1 coverage"
          title="Shade the 7 Rubin DP1 fields — data exists only inside these (~15 deg² total); elsewhere the viewer shows DSS"
          onclick={toggleCoverage}
        >
          ⊙ DP1 coverage
        </button>

        <button
          class="xsection-toggle"
          class:on={showCatalog}
          aria-pressed={showCatalog}
          aria-label="Toggle Gaia catalog"
          title="Overlay Gaia DR3 sources near the view centre + a linked table (public — no token)"
          onclick={toggleCatalog}
        >
          ◎ Gaia{#if showCatalog && catalog} ({catalog.count.toLocaleString()}){/if}
        </button>

        {#if showCatalog}
          <button
            class="xsection-toggle"
            class:on={showPmVectors}
            aria-pressed={showPmVectors}
            aria-label="Toggle Gaia proper-motion vectors"
            title="Draw proper-motion arrows (μα*, μδ) from each Gaia marker — direction + length show the star's motion on the sky"
            onclick={togglePmVectors}
          >
            ↗ PM vectors
          </button>
        {/if}

        <button
          class="xsection-toggle"
          class:on={showLenses}
          aria-pressed={showLenses}
          aria-label="Toggle gravitational lens catalog"
          title="Overlay known strong gravitational lenses (bundled, web-verified) + a linked table — click a lens to recenter and see its type/redshift"
          onclick={toggleLenses}
        >
          ⬦ Lenses{#if showLenses && lensCatalog} ({lensCatalog.count}){/if}
        </button>

        <button
          class="xsection-toggle"
          class:on={showRubinObjects}
          aria-pressed={showRubinObjects}
          aria-label="Toggle Rubin Object catalog"
          title="Overlay live Rubin DP1 dp1.Object sources near the view centre + a linked table (requires a Rubin base + an RSP token with DP1 data rights)"
          onclick={toggleRubinObjects}
        >
          ✚ Rubin Obj (DP1){#if showRubinObjects && rubinCatalog} ({rubinCatalog.count.toLocaleString()}){/if}
        </button>

        <button
          class="xsection-toggle"
          class:on={rulerMode}
          aria-pressed={rulerMode}
          aria-label="Toggle distance ruler"
          title="Drag between two points to measure the great-circle separation and position angle"
          onclick={toggleRuler}
        >
          📏 Ruler{#if rulerReadout} · {rulerReadout}{/if}
        </button>

        <button
          class="xsection-toggle"
          class:on={regionMode}
          aria-pressed={regionMode}
          aria-label="Toggle region drawing"
          title="Draw DS9 regions: a circle (drag) or polygon (click vertices, close on the first). Sky-anchored (RA/Dec) so they track pan/zoom."
          onclick={toggleRegionMode}
        >
          ⬡ Regions{#if regions.length} ({regions.length}){/if}
        </button>

        {#if regionMode}
          <label class="rubin-filter" aria-label="Region shape">
            <span class="layer-label">Shape</span>
            <select
              value={regionShape}
              aria-label="Region shape select"
              onchange={(e) => setRegionShape((e.currentTarget as HTMLSelectElement).value as 'circle' | 'polygon')}
            >
              <option value="circle">Circle (drag)</option>
              <option value="polygon">Polygon (click)</option>
            </select>
          </label>
        {/if}

        {#if regionMode || regions.length}
          <button
            class="xsection-toggle"
            aria-label="Export regions as DS9 .reg file"
            title="Download the current regions as a DS9 .reg file"
            onclick={exportRegions}
          >
            ⭳ Export .reg
          </button>
          <button
            class="xsection-toggle"
            class:on={regionImportOpen}
            aria-pressed={regionImportOpen}
            aria-label="Import DS9 regions"
            title="Paste or upload a DS9 region file to render"
            onclick={() => { regionImportOpen = !regionImportOpen; regionImportMessage = null; }}
          >
            ⭱ Import
          </button>
          {#if regions.length}
            <button
              class="xsection-toggle"
              aria-label="Clear all regions"
              title="Remove every drawn/imported region"
              onclick={clearRegions}
            >
              ✕ Clear regions
            </button>
          {/if}
        {/if}

        <button
          class="xsection-toggle"
          class:on={showMagnifier}
          aria-pressed={showMagnifier}
          aria-label="Toggle magnifier"
          title="Magnifier loupe: a zoomed view of the pixels under the cursor"
          onclick={toggleMagnifier}
        >
          🔍 Loupe
        </button>

        <button
          class="xsection-toggle"
          class:on={showPerfHud}
          aria-pressed={showPerfHud}
          aria-label="Toggle performance HUD"
          title="Live performance HUD: FPS, render time, tiles loaded vs cache hit-rate, in-flight fetches, tile load time, errors"
          onclick={togglePerfHud}
        >
          ⏱ Perf
        </button>

        <button
          class="xsection-toggle"
          class:on={cutoutOpen}
          aria-pressed={cutoutOpen}
          aria-label="Toggle FITS cutout"
          title="Fetch a real DP1 SODA image cutout at the view centre — linear-float FITS pixels with a calibrated RA/Dec readout (requires an RSP token with DP1 rights)"
          onclick={toggleCutout}
        >
          🔬 Cutout
        </button>

        <button
          class="xsection-toggle"
          class:on={rgbOpen}
          aria-pressed={rgbOpen}
          aria-label="Toggle RGB composite"
          title="Fetch three per-band DP1 SODA cutouts (i, r, g) at the view centre and composite them with the Lupton asinh recipe — a true colour image (requires an RSP token with DP1 rights)"
          onclick={toggleRgb}
        >
          🌈 RGB
        </button>

        <button
          class="xsection-toggle"
          aria-label="Save PNG screenshot"
          title="Download the current view (base + overlays + grid) as a PNG image"
          onclick={() => { imageViewerRef?.exportPng(); statusMessage = 'Saved PNG screenshot of the current view'; }}
        >
          ⤓ PNG
        </button>

        <!-- Always visible so the feature is discoverable; if there's no epoch
             source (not offline, not an authenticated Rubin base) the click
             explains the prerequisite instead of the button silently missing. -->
          <button
            class="xsection-toggle"
            class:on={lightCurveMode}
            aria-pressed={lightCurveMode}
            aria-label="Toggle light curve"
            title={baseLayerId === 'offline'
              ? 'Synthetic intensity vs time at the view centre (offline cube)'
              : 'Fetch a real DP1 forced-photometry light curve at the view centre (TAP)'}
            onclick={toggleLightCurve}
          >
            ⌇ Light curve
          </button>
          <button
            class="xsection-toggle"
            class:on={gaiaLcMode}
            aria-pressed={gaiaLcMode}
            aria-label="Toggle Gaia variable light curve"
            title="Gaia DR2 epoch-photometry light curve of a variable star at the view centre (public, no token)"
            onclick={toggleGaiaLc}
          >
            ✧ Gaia var
          </button>

        {#if baseLayerId === 'offline'}
          <button
            class="xsection-toggle"
            class:on={diffMode}
            aria-pressed={diffMode}
            aria-label="Toggle image differencing"
            title="Difference two epochs of the synthetic cube to find transients (offline ground truth)"
            onclick={toggleDiff}
          >
            ⧉ Diff
          </button>
          <button
            class="xsection-toggle"
            class:on={varMode}
            aria-pressed={varMode}
            aria-label="Toggle variability map"
            title="Per-pixel temporal variability across ALL epochs of the synthetic cube (offline ground truth)"
            onclick={toggleVariability}
          >
            ⚡ Variability
          </button>
        {/if}

        {#if showAlerts}
          <label class="alert-source" aria-label="Alert source select">
            <span class="layer-label">Source</span>
            <select bind:value={alertSource} onchange={handleAlertSourceChange} aria-label="Alert source">
              <option value="synthetic">Synthetic demo</option>
              <option value="live">Live DIA (Rubin)</option>
            </select>
            {#if alertSource === 'live'}
              <button
                class="dia-refresh"
                aria-label="Refresh DIA at view centre"
                title="Fetch DIASources at the current view centre"
                onclick={loadDiaAlerts}
                disabled={alertLoading}
              >↻</button>
            {/if}
          </label>
          <span class="alert-legend" aria-label="Alert type filter">
            {#each ALERT_TYPE_NAMES as name, t (t)}
              <button
                class="type-chip"
                class:off={!typeVisible(alertTypeMask, t)}
                aria-pressed={typeVisible(alertTypeMask, t)}
                aria-label={`Toggle ${name} alerts`}
                onclick={() => toggleAlertType(t)}
              >
                <span class="type-dot" style={`background:${ALERT_TYPE_COLORS[t]}`}></span>
                {name}
              </button>
            {/each}
          </span>
          {#if alertMjdBounds}
            <span class="alert-time" aria-label="Alert time window">
              <span class="layer-label">Time</span>
              <input
                type="range" min={alertMjdBounds[0]} max={alertMjdBounds[1]} step="1"
                bind:value={alertWindowMin}
                oninput={() => { if (alertWindowMin > alertWindowMax) alertWindowMax = alertWindowMin; }}
                aria-label="Alert window start (MJD)"
              />
              <input
                type="range" min={alertMjdBounds[0]} max={alertMjdBounds[1]} step="1"
                bind:value={alertWindowMax}
                oninput={() => { if (alertWindowMax < alertWindowMin) alertWindowMin = alertWindowMax; }}
                aria-label="Alert window end (MJD)"
              />
              <span class="alert-time-readout" aria-label="Alert window count">
                MJD {alertWindowMin.toFixed(0)}–{alertWindowMax.toFixed(0)} · {alertWindowCount.toLocaleString()}
              </span>
            </span>
          {/if}
        {/if}
      </div>
    {/if}

    {#if uiVisible && showAlerts && alertHover}
      <div class="alert-inspector" aria-label="Alert inspector">
        <span class="ai-type" style={`color:${ALERT_TYPE_COLORS[alertHover.type]}`}>
          ● {ALERT_TYPE_NAMES[alertHover.type]}
        </span>
        <span class="ai-row">#{alertHover.id ?? alertHover.index}</span>
        <span class="ai-row">mag {alertHover.magnitude.toFixed(2)}</span>
        <span class="ai-row">MJD {alertHover.timeMjd.toFixed(2)}</span>
        <span class="ai-row">RA {alertHover.ra.toFixed(4)}, Dec {alertHover.dec >= 0 ? '+' : ''}{alertHover.dec.toFixed(4)}</span>
        <span class="ai-note">synthetic demo event</span>
      </div>
    {/if}
    {#if uiVisible && regionImportOpen}
      <div class="region-import" role="region" aria-label="Import DS9 regions">
        <div class="ri-header">
          <span class="ri-title">Import DS9 regions</span>
          <button class="ri-close" aria-label="Close region import" onclick={() => { regionImportOpen = false; }}>×</button>
        </div>
        <textarea
          class="ri-textarea"
          aria-label="DS9 region text"
          placeholder={REGION_IMPORT_PLACEHOLDER}
          bind:value={regionImportText}
        ></textarea>
        <div class="ri-actions">
          <button class="ri-btn" aria-label="Parse pasted regions" onclick={importFromTextarea}>Add pasted regions</button>
          <button class="ri-btn" aria-label="Choose region file" onclick={() => regionFileInput?.click()}>Upload .reg file…</button>
          <input
            bind:this={regionFileInput}
            type="file"
            accept=".reg,.txt,text/plain"
            aria-label="Region file input"
            style="display:none"
            onchange={handleRegionFile}
          />
        </div>
        {#if regionImportMessage}
          <div class="ri-message" aria-label="Region import message">{regionImportMessage}</div>
        {/if}
      </div>
    {/if}

    {#if uiVisible && (identifyInfo || simbadQuery || showCatalog || showLenses || showRubinObjects || crossSectionMode || surfaceMode || lightCurveMode || gaiaLcMode || cutoutOpen || rgbOpen || (diffMode && baseLayerId === 'offline') || (varMode && baseLayerId === 'offline'))}
      <!-- Right-side stack: the object-ID popup sits ABOVE the analysis plots so
           they never overlap. -->
      <div class="right-stack">
        {#if identifyInfo}
          <ObjectInfoPanel
            info={identifyInfo}
            imageClass={imageClass}
            onClose={() => { identifyInfo = null; imageClass = null; }}
          />
        {/if}
        {#if simbadQuery}
          <SimbadPanel
            ra={simbadQuery.ra}
            dec={simbadQuery.dec}
            results={simbadResults}
            status={simbadStatus}
            onSelect={handleSimbadSelect}
            onClose={() => { simbadQuery = null; simbadResults = null; simbadStatus = null; }}
          />
        {/if}
        {#if showCatalog}
          <CatalogTable
            {catalog}
            selectedIndex={selectedCatalogIndex}
            title="Gaia DR3"
            status={catalogLoading ? 'Loading…' : catalogStatus}
            onSelect={handleCatalogSelect}
            onClose={toggleCatalog}
          />
          {#if gaiaRaw && gaiaRaw.count > 0}
            <ColorMagnitudeDiagram
              catalog={gaiaRaw}
              selectedIndex={selectedCatalogIndex}
              onSelect={handleCatalogSelect}
              onClose={toggleCatalog}
            />
          {/if}
        {/if}
        {#if showLenses}
          <CatalogTable
            catalog={lensCatalog}
            selectedIndex={selectedLensIndex}
            title="Gravitational lenses"
            caption="Known strong-lens positions (all-sky). Arcs/rings (mag ~20–26) need deep imaging — Rubin coadds or HST; lensed-quasar doubles/quads show in Gaia. None lie in a DP1 field."
            onSelect={handleLensSelect}
            onClose={toggleLenses}
          />
        {/if}
        {#if showRubinObjects}
          <CatalogTable
            catalog={rubinCatalog}
            selectedIndex={selectedRubinIndex}
            title="Rubin Object (DP1)"
            status={rubinObjLoading ? 'Loading…' : rubinObjStatus}
            onSelect={handleRubinSelect}
            onClose={toggleRubinObjects}
          />
        {/if}
        {#if diffMode && baseLayerId === 'offline'}
          <DiffPanel
            order={DIFF_ORDER}
            pixelIndex={diffPix}
            band={offlineBand}
            epochs={OFFLINE_EPOCHS}
            aIndex={diffAIndex}
            bIndex={diffBIndex}
            onAChange={(i) => { diffAIndex = i; }}
            onBChange={(i) => { diffBIndex = i; }}
            onClose={toggleDiff}
          />
        {/if}
        {#if varMode && baseLayerId === 'offline'}
          <VariabilityPanel
            order={DIFF_ORDER}
            pixelIndex={diffPix}
            band={offlineBand}
            epochs={OFFLINE_EPOCHS}
            onClose={toggleVariability}
          />
        {/if}
        {#if cutoutOpen}
          {#if cutoutStatus === 'loaded' && cutoutImage && cutoutMeta}
            <CutoutPanel
              image={cutoutImage}
              ra={cutoutMeta.ra}
              dec={cutoutMeta.dec}
              band={cutoutMeta.band}
              datasetId={cutoutMeta.datasetId}
              onClose={toggleCutout}
            />
          {:else}
            <div class="cutout-status" aria-label="FITS cutout status">
              <div class="cs-header">
                <span class="cs-title">FITS cutout</span>
                <button class="cs-close" aria-label="Close cutout" onclick={toggleCutout}>×</button>
              </div>
              {#if cutoutStatus === 'loading'}
                <div class="cs-loading" aria-label="Cutout loading">Fetching cutout…</div>
              {:else if cutoutStatus === 'error'}
                <div class="cs-error" aria-label="Cutout error">{cutoutError}</div>
                <button class="cs-retry" aria-label="Retry cutout" onclick={fetchCutout}>Retry at view centre</button>
              {/if}
            </div>
          {/if}
        {/if}
        {#if rgbOpen}
          {#if rgbStatus === 'loaded' && rgbImages && rgbMeta}
            <RgbCompositePanel
              images={rgbImages}
              ra={rgbMeta.ra}
              dec={rgbMeta.dec}
              onClose={toggleRgb}
            />
          {:else}
            <div class="cutout-status" aria-label="RGB composite status">
              <div class="cs-header">
                <span class="cs-title">RGB composite</span>
                <button class="cs-close" aria-label="Close RGB composite" onclick={toggleRgb}>×</button>
              </div>
              {#if rgbStatus === 'loading'}
                <div class="cs-loading" aria-label="RGB composite loading">Fetching i / r / g cutouts…</div>
              {:else if rgbStatus === 'error'}
                <div class="cs-error" aria-label="RGB composite error">{rgbError}</div>
                <button class="cs-retry" aria-label="Retry RGB composite" onclick={fetchRgb}>Retry at view centre</button>
              {/if}
            </div>
          {/if}
        {/if}
        {#if crossSectionMode}
          <CrossSectionPlot profile={crossSectionProfile} onClose={toggleCrossSection} />
        {/if}
        {#if surfaceMode}
          <SurfacePlot
            grid={surfaceGrid}
            onClose={toggleSurface}
            title="3D surface · line over time"
            xLabel="position along line →"
            depthLabel="epoch (time), earliest at back"
            caption="cross-section line intensity vs epoch (normalised) · row = time, col = position"
            emptyMessage={surfaceEmptyMessage}
          />
        {/if}
        {#if lightCurveMode && baseLayerId === 'offline'}
          <LightCurvePlot curve={offlineLc} currentIndex={offlineEpochIndex} band={offlineBand} onClose={toggleLightCurve} />
        {:else if lightCurveMode && rubinLcAvailable}
          <LightCurvePlot
            curve={rubinLcCurve}
            band="r"
            title="Rubin light curve"
            status={rubinLcStatus}
            footNote="DP1 forced photometry (r-band) via TAP · requires RSP token + DP1 rights"
            onRefresh={fetchRubinLc}
            onClose={toggleLightCurve}
          />
        {:else if lightCurveMode}
          <!-- No epoch source (no offline cube, no authenticated Rubin base):
               show WHY instead of an invisible no-op. -->
          <div class="lc-nosource" aria-label="Light curve unavailable">
            <div class="lc-nosource-title">Light curve unavailable</div>
            <div class="lc-nosource-msg">{rubinLcStatus ?? 'No epoch source at this position.'}</div>
            <button class="lc-nosource-close" aria-label="Close light curve" onclick={toggleLightCurve}>Dismiss</button>
          </div>
        {/if}
        {#if gaiaLcMode}
          <LightCurvePlot
            curve={gaiaLcCurve}
            band="G"
            title="Gaia DR2 variable"
            status={gaiaLcStatus}
            footNote={gaiaLcSourceId
              ? `Gaia DR2 ${gaiaLcSourceId} · G-band flux (e⁻/s) vs time · epoch photometry (GAVO)`
              : 'Gaia DR2 epoch photometry (public GAVO mirror) · variable stars only'}
            onRefresh={fetchGaiaLc}
            onClose={toggleGaiaLc}
          />
        {/if}
      </div>
    {/if}

    <div class="object-browser-overlay">
      <ObjectBrowser onObjectSelect={handleObjectSelect} />
    </div>
  </div>

  {#if uiVisible}
    <ColorBar {colorMap} minValue={0} maxValue={1} />
    <StatusBar ra={currentRa} dec={currentDec} {zoomLevel} message={statusMessage} />
  {/if}

  <HelpModal open={helpOpen} onClose={() => { helpOpen = false; }} />

  <TokenDialog
    open={tokenDialogOpen}
    onClose={() => { tokenDialogOpen = false; }}
    onTokenChange={handleTokenChange}
  />
</div>

<style>
  .tile-viewer {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #111;
  }

  .viewer-area {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .object-browser-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 15;
    max-height: 50%;
    overflow-y: auto;
  }

  .active-layers {
    position: absolute;
    top: 8px;
    left: 8px;
    /* Above the interactive overlay canvases (z-index ≤ 7) so the toolbar stays
       clickable while a pointer-stealing tool (region / ruler / cross-section) is
       active — otherwise an active full-viewer overlay intercepts button clicks. */
    z-index: 12;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    max-width: 60%;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .layer-base,
  .rubin-filter {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(10, 10, 30, 0.8);
    border: 1px solid rgba(100, 100, 255, 0.3);
    border-radius: 6px;
    padding: 3px 8px;
    color: #aac;
  }
  .rubin-filter {
    border-color: rgba(120, 200, 255, 0.4);
  }
  .rubin-filter select {
    background: #1a1a2e;
    color: #cef;
    border: 1px solid #345;
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 11px;
    font-family: inherit;
  }

  .layer-label {
    color: #88a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .base-resolved {
    color: #789;
    font-size: 10px;
  }

  .field-chip {
    background: rgba(30, 40, 60, 0.85);
    border: 1px solid rgba(120, 200, 255, 0.45);
    border-radius: 6px;
    padding: 3px 8px;
    color: #bdf;
  }

  .layer-base select {
    background: #1a1a2e;
    color: #ccf;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 11px;
    font-family: inherit;
  }

  .layer-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(20, 40, 30, 0.85);
    border: 1px solid rgba(110, 224, 140, 0.35);
    border-radius: 6px;
    padding: 3px 6px 3px 8px;
    color: #bfe;
  }

  .chip-remove {
    background: none;
    border: none;
    color: #9cb;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 0 2px;
  }

  .chip-remove:hover {
    color: #fff;
  }

  .alert-toggle {
    background: rgba(10, 10, 30, 0.8);
    border: 1px solid rgba(255, 180, 60, 0.35);
    border-radius: 6px;
    padding: 3px 8px;
    color: #fc8;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .xsection-toggle {
    background: rgba(10, 10, 30, 0.8);
    border: 1px solid rgba(120, 200, 255, 0.35);
    border-radius: 6px;
    padding: 3px 8px;
    color: #9cf;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .xsection-toggle.on {
    background: rgba(20, 40, 60, 0.9);
    color: #bdf;
    border-color: rgba(120, 200, 255, 0.7);
  }

  .lc-nosource {
    background: rgba(12, 14, 22, 0.97);
    border: 1px solid rgba(120, 200, 255, 0.5);
    border-radius: 8px;
    padding: 10px 12px;
    color: #d8e2f0;
    font-size: 12px;
    width: 260px;
  }
  .lc-nosource-title { color: #9cf; font-weight: 700; margin-bottom: 4px; }
  .lc-nosource-msg { color: #bcd; line-height: 1.4; }
  .lc-nosource-close {
    margin-top: 8px; background: #1a2a44; color: #cde; border: 1px solid #345;
    border-radius: 4px; padding: 3px 10px; font: inherit; font-size: 11px; cursor: pointer;
  }
  .lc-nosource-close:hover { background: #24406a; }

  .region-import {
    position: absolute;
    top: 44px;
    left: 12px;
    z-index: 17;
    width: 320px;
    background: #12122a;
    border: 1px solid #3a6;
    border-radius: 6px;
    padding: 8px;
    color: #ccd;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .region-import .ri-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .region-import .ri-title { color: #9f9; font-weight: 700; }
  .region-import .ri-close {
    background: #22243a;
    border: 1px solid #445;
    border-radius: 4px;
    color: #ccd;
    cursor: pointer;
    padding: 2px 7px;
    font-family: inherit;
  }
  .region-import .ri-textarea {
    width: 100%;
    height: 90px;
    box-sizing: border-box;
    background: #0b0b18;
    border: 1px solid #345;
    border-radius: 4px;
    color: #cfe;
    font-family: inherit;
    font-size: 11px;
    padding: 6px;
    resize: vertical;
  }
  .region-import .ri-actions {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .region-import .ri-btn {
    background: #1a3a24;
    border: 1px solid #3a6;
    border-radius: 4px;
    color: #cfe;
    cursor: pointer;
    padding: 4px 8px;
    font-family: inherit;
    font-size: 11px;
  }
  .region-import .ri-btn:hover { background: #245a34; }
  .region-import .ri-message {
    margin-top: 6px;
    color: #bd9;
    line-height: 1.4;
  }

  .right-stack {
    position: absolute;
    top: 44px;
    right: 12px;
    z-index: 16;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
    max-height: calc(100% - 120px);
    overflow-y: auto;
  }

  .alert-toggle.on {
    background: rgba(60, 40, 10, 0.9);
    color: #ffd24d;
    border-color: rgba(255, 200, 80, 0.7);
  }

  .alert-legend {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .alert-time {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: rgba(10, 10, 30, 0.8);
    border: 1px solid rgba(255, 180, 60, 0.35);
    border-radius: 6px;
    padding: 2px 8px;
    color: #fc8;
  }
  .alert-time input[type='range'] {
    width: 70px;
    accent-color: #fc8;
  }
  .alert-time-readout {
    color: #fda;
    font-size: 10px;
    white-space: nowrap;
  }

  .alert-inspector {
    position: absolute;
    left: 8px;
    bottom: 8px;
    z-index: 18;
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: rgba(12, 10, 20, 0.95);
    border: 1px solid rgba(255, 180, 60, 0.5);
    border-radius: 6px;
    padding: 6px 10px;
    color: #eda;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .alert-inspector .ai-type {
    font-weight: 700;
  }
  .alert-inspector .ai-row {
    color: #ccb;
  }
  .alert-inspector .ai-note {
    color: #987;
    font-size: 9px;
    margin-top: 2px;
  }

  .type-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(10, 10, 30, 0.8);
    border: 1px solid #333;
    border-radius: 5px;
    padding: 2px 6px;
    color: #ccd;
    font-family: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .type-chip.off {
    opacity: 0.4;
    text-decoration: line-through;
  }

  .type-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .ui-hidden .viewer-area {
    height: 100vh;
  }

  .cutout-status {
    background: rgba(12, 14, 22, 0.97);
    border: 1px solid rgba(120, 200, 255, 0.5);
    border-radius: 8px;
    padding: 8px 10px;
    color: #d8e2f0;
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    width: 300px;
  }
  .cutout-status .cs-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }
  .cutout-status .cs-title { color: #9cf; font-weight: 700; }
  .cutout-status .cs-close {
    background: none;
    border: none;
    color: #aaa;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .cutout-status .cs-close:hover { color: #fff; }
  .cutout-status .cs-loading { color: #9cf; }
  .cutout-status .cs-error { color: #f99; white-space: pre-wrap; line-height: 1.4; }
  .cutout-status .cs-retry {
    margin-top: 8px;
    background: rgba(20, 40, 60, 0.9);
    border: 1px solid rgba(120, 200, 255, 0.5);
    border-radius: 5px;
    color: #bdf;
    font: inherit;
    font-size: 10px;
    padding: 3px 8px;
    cursor: pointer;
  }

  /* --- Responsive breakpoints (feature 127) --------------------------------- */
  /* Tablet / small window: the control cluster may use the full width instead of
     being capped at 60% (which crams the toggles into a tall column), and panels
     never exceed the viewport. */
  @media (max-width: 720px) {
    .active-layers {
      max-width: calc(100% - 12px);
      gap: 3px;
    }
    .active-layers button,
    .active-layers select {
      padding: 3px 5px;
      font-size: 11px;
    }
    .right-stack {
      max-width: calc(100vw - 20px);
      top: 40px;
    }
  }
  /* Phone: tighten margins, and let the right-hand analysis panels span the width
     so they don't overflow off-screen; give touch targets a little more height. */
  @media (max-width: 480px) {
    .active-layers {
      top: 4px;
      left: 4px;
    }
    .right-stack {
      left: 4px;
      right: 4px;
      max-width: none;
      align-items: stretch;
    }
    .active-layers button,
    .active-layers select {
      min-height: 30px;
    }
  }
</style>
