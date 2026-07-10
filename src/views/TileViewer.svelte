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
  import { OFFLINE_EPOCHS, OFFLINE_BANDS, brightestOfflineVariable } from '../data/offlineDataset.js';
  import { RUBIN_DATASETS } from '../utils/baseLayer.js';
  import type { IdentifyInfo } from '../data/objects.js';
  import type { Band } from '../data/syntheticSky.js';
  import type { LineProfile } from '../utils/crossSection.js';
  import type { ScalingFunction, ColorMapName, InterpolationMethod, ViewerState, Epoch } from '../types/image.js';
  import { mjdToIso } from '../types/image.js';
  import { DEFAULT_MOCK_EPOCHS, type SurveyInfo } from '../constants.js';
  import type { FilterBand } from '../constants.js';
  import { getToken, isAuthenticated } from '../api/auth.js';
  import { lookupObject, type AstroObject } from '../data/objects.js';
  import {
    generateSyntheticAlerts,
    buildAlertIndex,
    allTypesMask,
    typeVisible,
    ALERT_TYPE_NAMES,
    ALERT_TYPE_COLORS,
    type AlertSet,
    type AlertIndex,
  } from '../data/alerts.js';

  let scaling: ScalingFunction = $state('linear');
  let colorMap: ColorMapName = $state('grayscale');
  let interpolation: InterpolationMethod = $state('bilinear');
  let invert = $state(false);
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

  let currentRa = $state(62.0);
  let currentDec = $state(-37.0);
  let zoomLevel = $state(3);
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
  // Alert / DIA overlay. Synthetic data is generated lazily on first enable
  // (stand-in for the real, auth-gated Rubin alert stream).
  let showAlerts = $state(false);
  let alerts: AlertSet | null = $state(null);
  let alertIndex: AlertIndex | null = $state(null);
  let alertTypeMask = $state(allTypesMask());
  const ALERT_SYNTHETIC_COUNT = 200000;

  function toggleAlerts() {
    showAlerts = !showAlerts;
    if (showAlerts && !alerts) {
      alerts = generateSyntheticAlerts(ALERT_SYNTHETIC_COUNT, 1);
      alertIndex = buildAlertIndex(alerts);
      statusMessage = `Alerts: ${alerts.count.toLocaleString()} synthetic events loaded`;
    } else {
      statusMessage = showAlerts ? 'Alerts: on' : 'Alerts: off';
    }
  }

  function toggleAlertType(t: number) {
    alertTypeMask = alertTypeMask ^ (1 << t);
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
    statusMessage = crossSectionMode
      ? 'Cross-section: drag a line across the image to profile intensity'
      : 'Cross-section: off';
  }

  // Rubin DP1 multi-filter: switch the active HiPS dataset (gri/ugri/… colour
  // composites or a single ugrizy band). Shown when the Rubin base is active.
  let rubinDataset = $state('color_gri');

  // Offline synthetic cube browsing: independent time (epoch) and wavelength
  // (band) axes. Only meaningful while the offline base layer is active; drive
  // ImageViewer to re-synthesize tiles per (band, mjd).
  let offlineBand = $state<Band>('r');
  let offlineEpochIndex = $state(0);
  let offlineBlinkPlaying = $state(false);
  const offlineMjd = $derived(OFFLINE_EPOCHS[offlineEpochIndex] ?? OFFLINE_EPOCHS[0] ?? 60000);

  let baseLayerId = $state<'auto' | 'dss' | 'rubin' | 'offline'>('auto');
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

  // Time series state
  const mockEpochs: Epoch[] = DEFAULT_MOCK_EPOCHS.map(e => ({
    mjd: e.mjd,
    isoDate: mjdToIso(e.mjd),
    filter: e.filter,
  }));
  let currentEpochIndex = $state(0);

  // Blink state
  let blinkPlaying = $state(false);
  let blinkRate = $state(1.0);
  const blinkTargets = $derived(mockEpochs.map((e, i) => ({
    id: `epoch-${i}`,
    label: `Epoch ${i + 1} (${e.filter ?? '?'})`
  })));
  let blinkIndex = $state(0);
  let isPlaying = $state(false);

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
    statusMessage = `Go to RA=${ra.toFixed(2)}°, Dec=${dec.toFixed(2)}°`;
  }

  function handleEpochChange(index: number, epoch: Epoch) {
    currentEpochIndex = index;
    statusMessage = `Epoch ${index + 1}: MJD ${epoch.mjd.toFixed(2)} (${epoch.filter ?? '—'})`;
  }

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

  function handleBlinkTargetChange(index: number) {
    blinkIndex = index;
    currentEpochIndex = index;
    const epoch = mockEpochs[index];
    if (epoch) {
      statusMessage = `Blink: Epoch ${index + 1} (${epoch.filter ?? '—'})`;
    }
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
    epochs={mockEpochs}
    {currentEpochIndex}
    {isPlaying}
    {activeFilter}
    {compositeMode}
    {compositeChannels}
    {surveyOverlays}
    {blinkTargets}
    {blinkIndex}
    {blinkPlaying}
    {blinkRate}
    onScalingChange={(s) => { scaling = s; statusMessage = `Scaling: ${s}`; }}
    onColorMapChange={(c) => { colorMap = c; statusMessage = `Color map: ${c}`; }}
    onInterpolationChange={(i) => { interpolation = i; statusMessage = `Interpolation: ${i}`; }}
    onInvertChange={(v) => { invert = v; statusMessage = `Invert: ${v ? 'ON' : 'OFF'}`; }}
    onStretchChange={handleStretchChange}
    onEpochChange={handleEpochChange}
    onPlayStateChange={(p) => { isPlaying = p; }}
    onFilterChange={handleFilterChange}
    onCompositeChange={handleCompositeChange}
    onOverlayAdd={handleOverlayAdd}
    onOverlayRemove={handleOverlayRemove}
    onOpacityChange={handleOpacityChange}
    onBlinkTargetChange={handleBlinkTargetChange}
    onBlinkPlayStateChange={(p) => { blinkPlaying = p; }}
    onBlinkRateChange={(r) => { blinkRate = r; }}
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
      {crossSectionMode}
      {rubinDataset}
      {offlineBand}
      {offlineMjd}
      initialRa={62.0}
      initialDec={-37.0}
      initialZoom={3}
      onViewerStateChange={handleViewerStateChange}
      onBaseResolved={(label) => { resolvedBaseLabel = label; }}
      onProfileChange={(p) => { crossSectionProfile = p; }}
      onIdentify={handleIdentify}
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
            <span class="layer-label">Filter</span>
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
          title="Synthetic demo events — NOT real Rubin alerts (no live alert-stream connection yet)"
          onclick={toggleAlerts}
        >
          ◈ Alerts (demo{#if alerts && showAlerts}, {alerts.count.toLocaleString()}{/if})
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

        {#if showAlerts}
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
        {/if}
      </div>
    {/if}
    {#if uiVisible && (identifyInfo || crossSectionMode)}
      <!-- Right-side stack: the object-ID popup sits ABOVE the cross-section plot
           so they never overlap. -->
      <div class="right-stack">
        {#if identifyInfo}
          <ObjectInfoPanel info={identifyInfo} onClose={() => { identifyInfo = null; }} />
        {/if}
        {#if crossSectionMode}
          <CrossSectionPlot profile={crossSectionProfile} onClose={toggleCrossSection} />
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
</style>
