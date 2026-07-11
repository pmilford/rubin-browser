<script lang="ts">
  import ImageViewer from '../components/ImageViewer.svelte';
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
  import CutoutPanel from '../components/CutoutPanel.svelte';
  import { fetchCutoutAt } from '../api/soda.js';
  import { readFits, type FitsImage } from '../utils/fits.js';
  import { radecToTileIndex } from '../api/hips.js';
  import CatalogTable from '../components/CatalogTable.svelte';
  import ColorMagnitudeDiagram from '../components/ColorMagnitudeDiagram.svelte';
  import { fetchGaiaCone, type GaiaCatalog } from '../api/gaia.js';
  import { gaiaToCatalogSet, type CatalogSet } from '../data/catalog.js';
  import { lensCatalogSet } from '../data/lenses.js';
  import SurfacePlot from '../components/SurfacePlot.svelte';
  import { OFFLINE_EPOCHS, OFFLINE_BANDS, brightestOfflineVariable, offlineLightCurve } from '../data/offlineDataset.js';
  import LightCurvePlot from '../components/LightCurvePlot.svelte';
  import { RUBIN_DATASETS } from '../utils/baseLayer.js';
  import type { IdentifyInfo } from '../data/objects.js';
  import type { Band } from '../data/syntheticSky.js';
  import type { LineProfile } from '../utils/crossSection.js';
  import type { ScalingFunction, ColorMapName, InterpolationMethod, ViewerState } from '../types/image.js';
  import { SURVEY_OVERLAYS, type SurveyInfo } from '../constants.js';
  import type { FilterBand } from '../constants.js';
  import { onMount } from 'svelte';
  import { readStateFromUrl, applyStateToUrl } from '../utils/urlState.js';
  import { DP1_FIELDS } from '../data/dp1Fields.js';
  import { GLOSSARY } from '../data/glossary.js';
  import { getToken, isAuthenticated } from '../api/auth.js';
  import { fetchLightCurve, toLightCurvePoints } from '../api/lightcurve.js';
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
    statusMessage = `Fetching Rubin DIASources near ${currentRa.toFixed(2)}, ${currentDec.toFixed(2)}…`;
    try {
      // ~1° radius ≈ a DP1 field; DP1 has no DIA outside its few small fields.
      const set = await fetchDiaAlerts({ ra: currentRa, dec: currentDec, radiusDeg: 1.0 });
      applyAlertSet(set);
      statusMessage =
        set.count > 0
          ? `Live DIA: ${set.count.toLocaleString()} DIASources near the view centre`
          : 'No DIA sources in this field (DP1 covers only a few small fields — try a DP1 field).';
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
  function handleIdentify(info: IdentifyInfo) {
    identifyInfo = info;
    statusMessage = info.match
      ? `Identified: ${info.match.object.name} (${info.match.object.type}, mag ${info.match.object.magnitude.toFixed(1)})`
      : `No catalogued object within ${(info.matchRadiusDeg * 60).toFixed(0)}′ of the click`;
  }

  // Cross-section / line-profile tool
  let crossSectionMode = $state(false);
  let crossSectionProfile = $state<LineProfile | null>(null);
  function toggleCrossSection() {
    crossSectionMode = !crossSectionMode;
    if (crossSectionMode) rulerMode = false; // both tools steal the pointer
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
      const parsed = readFits(fits);
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

  // Magnifier loupe of the pixels under the cursor.
  let showMagnifier = $state(false);
  function toggleMagnifier() {
    showMagnifier = !showMagnifier;
    statusMessage = showMagnifier ? 'Magnifier: on — move the cursor over the image' : 'Magnifier: off';
  }

  // Distance ruler: drag between two sky points → great-circle separation + PA.
  let rulerMode = $state(false);
  let rulerReadout = $state<string | null>(null);
  function toggleRuler() {
    rulerMode = !rulerMode;
    if (rulerMode) crossSectionMode = false; // both tools steal the pointer
    if (!rulerMode) rulerReadout = null;
    statusMessage = rulerMode
      ? 'Ruler: drag between two points to measure great-circle distance'
      : 'Ruler: off';
  }
  function handleRulerChange(m: { separationDeg: number; paDeg: number; text: string } | null) {
    rulerReadout = m?.text ?? null;
    if (m) statusMessage = `Distance: ${m.text}`;
  }

  // 3D surface ("mountain") plot of the central region's intensity.
  let surfaceMode = $state(false);
  let surfaceGrid = $state<number[][] | null>(null);
  function toggleSurface() {
    surfaceMode = !surfaceMode;
    statusMessage = surfaceMode
      ? '3D surface: central-region intensity as a relief (displayed luminance)'
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
    if (lightCurveMode && baseLayerId !== 'offline' && rubinLcAvailable) {
      void fetchRubinLc();
    }
    statusMessage = lightCurveMode ? 'Light curve: on' : 'Light curve: off';
  }

  // Rubin DP1 multi-filter: switch the active HiPS dataset (gri/ugri/… colour
  // composites or a single ugrizy band). Shown when the Rubin base is active.
  let rubinDataset = $state(seed.rubinDataset ?? 'color_gri');

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
      {rulerMode}
      onRulerChange={handleRulerChange}
      {rubinDataset}
      {offlineBand}
      {offlineMjd}
      initialRa={currentRa}
      initialDec={currentDec}
      initialZoom={zoomLevel}
      onViewerStateChange={handleViewerStateChange}
      onBaseResolved={(label) => { resolvedBaseLabel = label; }}
      onProfileChange={(p) => { crossSectionProfile = p; }}
      onSurfaceChange={(g) => { surfaceGrid = g; }}
      onIdentify={handleIdentify}
      onSkyContext={handleSkyContext}
    />

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
                {#each RUBIN_DATASETS.filter((d) => d.kind === 'color') as d (d.id)}
                  <option value={d.id}>{d.label}</option>
                {/each}
              </optgroup>
              <optgroup label="Single band">
                {#each RUBIN_DATASETS.filter((d) => d.kind === 'band') as d (d.id)}
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
          aria-label="Save PNG screenshot"
          title="Download the current view (base + overlays + grid) as a PNG image"
          onclick={() => { imageViewerRef?.exportPng(); statusMessage = 'Saved PNG screenshot of the current view'; }}
        >
          ⤓ PNG
        </button>

        {#if baseLayerId === 'offline' || rubinLcAvailable}
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
        {/if}

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
    {#if uiVisible && (identifyInfo || simbadQuery || showCatalog || showLenses || crossSectionMode || surfaceMode || lightCurveMode || cutoutOpen || (diffMode && baseLayerId === 'offline'))}
      <!-- Right-side stack: the object-ID popup sits ABOVE the analysis plots so
           they never overlap. -->
      <div class="right-stack">
        {#if identifyInfo}
          <ObjectInfoPanel info={identifyInfo} onClose={() => { identifyInfo = null; }} />
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
            onSelect={handleLensSelect}
            onClose={toggleLenses}
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
        {#if crossSectionMode}
          <CrossSectionPlot profile={crossSectionProfile} onClose={toggleCrossSection} />
        {/if}
        {#if surfaceMode}
          <SurfacePlot grid={surfaceGrid} onClose={toggleSurface} />
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
    z-index: 6;
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
</style>
