<script lang="ts">
  /**
   * Persistent object-identification panel shown when the user CLICKS the sky.
   * Distinct from the transient hover PixelReadout: it stays until closed and is
   * interactive. Shows type + brightness (the user's explicit ask) for the object
   * under the click, honestly reporting "nothing catalogued here" when the nearest
   * bright-catalog object is beyond the match radius rather than passing a far
   * star off as "here". Data is the bundled bright-object catalog (offline) — a
   * live Rubin/SIMBAD lookup is a future, auth-gated addition.
   */
  import { OBJECT_TYPE_LABELS, type IdentifyInfo } from '../data/objects.js';
  import { formatSeparation, cardinalDirection } from '../utils/skyGeom.js';
  import type { ImageClassification } from '../utils/objectClassifier.js';
  import { CATALOG_PROVENANCE } from '../utils/catalogClassify.js';

  let {
    info,
    imageClass = null,
    onClose,
  }: {
    info: IdentifyInfo | null;
    imageClass?: ImageClassification | null;
    onClose: () => void;
  } = $props();

  const fmtRa = (ra: number) => `${ra.toFixed(4)}°`;
  const fmtDec = (dec: number) => `${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°`;
  /** Magnitude honestly: a non-finite/absent value shows "—", never a fake 0. */
  const fmtMag = (m: number | undefined) =>
    typeof m === 'number' && Number.isFinite(m) ? m.toFixed(2) : '—';

  /** Human label for the inferred class (never a bare enum). */
  const CLASS_LABEL: Record<ImageClassification['cls'], string> = {
    star: 'Star',
    galaxy: 'Galaxy',
    unknown: 'Uncertain',
  };
  /** Format a feature number honestly: NaN/∞ → "—". */
  const fmtFeat = (v: number, digits = 2) =>
    typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
  /** True when a catalog cross-match (not pixel morphology) decided the class (TODO 151). */
  const catalogDecided = $derived(imageClass?.provenance === CATALOG_PROVENANCE);
</script>

{#if info}
  <div class="object-info" role="dialog" aria-label="Object identification">
    <button class="close" onclick={onClose} aria-label="Close object info" title="Close">×</button>

    {#if info.match}
      {@const o = info.match.object}
      <div class="name" aria-label="Object name">{o.name}</div>
      <dl class="fields">
        <dt>Type</dt>
        <dd aria-label="Object type">{OBJECT_TYPE_LABELS[o.type] ?? 'Other'}</dd>
        <dt>Brightness</dt>
        <dd aria-label="Object magnitude">mag {fmtMag(o.magnitude)}</dd>
        <dt>Offset</dt>
        <dd>{formatSeparation(info.match.separationDeg)} {cardinalDirection(info.match.positionAngleDeg)} from click</dd>
        {#if o.category}
          <dt>Catalog</dt>
          <dd>{o.category}</dd>
        {/if}
        {#if o.spectralType}
          <dt>Spectral</dt>
          <dd>{o.spectralType}</dd>
        {/if}
      </dl>
      {#if o.description}
        <div class="desc">{o.description}</div>
      {/if}
    {:else}
      <div class="name no-match">No catalogued object here</div>
      <div class="desc">
        {#if info.nearest}
          Nearest bright-catalog object: <strong>{info.nearest.object.name}</strong>,
          {formatSeparation(info.nearest.separationDeg)} {cardinalDirection(info.nearest.positionAngleDeg)}
          (beyond the {formatSeparation(info.matchRadiusDeg)} match radius).
        {:else}
          The bundled catalog is empty.
        {/if}
      </div>
    {/if}

    <dl class="fields coords">
      <dt>Position</dt>
      <dd aria-label="Clicked coordinates">RA {fmtRa(info.ra)}, Dec {fmtDec(info.dec)}</dd>
      <dt>Constellation</dt>
      <dd>{info.constellation}</dd>
    </dl>

    <div class="image-inferred" aria-label="Image-inferred classification">
      <div class="ii-head">
        {catalogDecided ? 'Classification' : 'Image-inferred'}
        <span class="ii-tag">{catalogDecided ? '(catalog cross-match)' : '(from pixels)'}</span>
      </div>
      {#if imageClass}
        {#if imageClass.cls === 'unknown'}
          <div class="ii-class ii-uncertain" aria-label="Inferred class">
            Uncertain — {imageClass.reason}
          </div>
        {:else}
          <div class="ii-class" aria-label="Inferred class">
            {CLASS_LABEL[imageClass.cls]}{imageClass.subtype ? ` — ${imageClass.subtype}` : ''}
            <span class="ii-mark">{catalogDecided ? '(catalog)' : '(image-inferred)'}</span>
          </div>
          <div class="ii-conf" aria-label="Inferred confidence">
            <span class="ii-conf-label">confidence {imageClass.confidence.toFixed(2)}</span>
            <span class="ii-bar"><span class="ii-bar-fill" style="width:{Math.round(Math.max(0, Math.min(1, imageClass.confidence)) * 100)}%"></span></span>
          </div>
        {/if}
        <details class="ii-features">
          <summary aria-label="Inferred features">features</summary>
          <dl class="fields">
            <dt>FWHM ÷ PSF</dt><dd aria-label="fwhmRatio">{fmtFeat(imageClass.features.fwhmRatio)}</dd>
            <dt>Concentration</dt><dd>{fmtFeat(imageClass.features.concentration)}</dd>
            <dt>Spread</dt><dd>{fmtFeat(imageClass.features.spreadModelProxy, 3)}</dd>
            <dt>SNR</dt><dd>{fmtFeat(imageClass.features.snr, 1)}</dd>
            <dt>Gaps</dt><dd>{fmtFeat(imageClass.features.gapFraction * 100, 0)}%</dd>
            {#if imageClass.features.saturatedCore}
              <dt>Saturated</dt><dd>yes (core clipped)</dd>
            {/if}
          </dl>
        </details>
        <div class="provenance" aria-label="Image provenance">{imageClass.provenance}</div>
      {:else}
        <div class="ii-class ii-uncertain">
          Cannot classify here — pixels unreadable or off image.
        </div>
      {/if}
    </div>

    <div class="provenance" aria-label="Data provenance">
      Local bright-object catalog (offline) — not a live Rubin query
    </div>
  </div>
{/if}

<style>
  .object-info {
    background: rgba(12, 14, 26, 0.95);
    border: 1px solid rgba(120, 160, 255, 0.4);
    border-radius: 8px;
    padding: 10px 12px 8px;
    color: #dce2f5;
    font-size: 12px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    min-width: 220px;
    max-width: 300px;
    position: relative;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  }

  .close {
    position: absolute;
    top: 4px;
    right: 6px;
    background: none;
    border: none;
    color: #9aa;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 0 2px;
  }
  .close:hover { color: #fff; }

  .name {
    font-size: 14px;
    font-weight: 700;
    color: #bcd4ff;
    margin: 0 18px 6px 0;
  }
  .name.no-match { color: #caa; }

  .fields {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0 0 6px;
  }
  .fields dt {
    color: #8a93b5;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.4px;
  }
  .fields dd { margin: 0; color: #e6ebfa; }

  .coords {
    border-top: 1px solid rgba(120, 160, 255, 0.18);
    padding-top: 6px;
  }

  .desc {
    color: #b7c0dc;
    margin: 4px 0 6px;
    line-height: 1.35;
  }

  .provenance {
    border-top: 1px solid rgba(120, 160, 255, 0.18);
    margin-top: 6px;
    padding-top: 5px;
    color: #7a84a6;
    font-size: 10px;
    line-height: 1.3;
  }

  /* Image-inferred block — visually distinct from the catalog fields (amber). */
  .image-inferred {
    border-top: 1px solid rgba(255, 190, 120, 0.28);
    margin-top: 6px;
    padding-top: 6px;
  }
  .ii-head {
    color: #f0b96b;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.4px;
    margin-bottom: 3px;
  }
  .ii-tag { color: #8a7a58; text-transform: none; letter-spacing: 0; }
  .ii-class {
    color: #ffd9a0;
    font-weight: 700;
    font-size: 13px;
  }
  .ii-class.ii-uncertain { color: #c9a; font-weight: 600; font-size: 12px; }
  .ii-mark { color: #a98a5c; font-weight: 400; font-size: 10px; }
  .ii-conf {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 3px 0;
    color: #d8c19a;
    font-size: 11px;
  }
  .ii-bar {
    flex: 1;
    height: 5px;
    background: rgba(255, 190, 120, 0.15);
    border-radius: 3px;
    overflow: hidden;
  }
  .ii-bar-fill { display: block; height: 100%; background: #f0b96b; }
  .ii-features { margin: 2px 0; }
  .ii-features summary {
    color: #8a93b5;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    cursor: pointer;
  }
  .ii-features .fields { margin-top: 4px; }
</style>
