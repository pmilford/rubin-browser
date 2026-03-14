<script lang="ts">
  import { SURVEY_OVERLAYS, type SurveyInfo } from '../constants.js';

  interface OverlayEntry {
    survey: SurveyInfo;
    opacity: number;
  }

  let {
    overlays = [] as OverlayEntry[],
    onOverlayAdd,
    onOverlayRemove,
    onOpacityChange,
  }: {
    overlays?: OverlayEntry[];
    onOverlayAdd?: (survey: SurveyInfo) => void;
    onOverlayRemove?: (surveyId: string) => void;
    onOpacityChange?: (surveyId: string, opacity: number) => void;
  } = $props();

  let expanded = $state(false);

  const activeSurveyIds = $derived(new Set(overlays.map(o => o.survey.id)));

  function toggleSurvey(survey: SurveyInfo) {
    if (activeSurveyIds.has(survey.id)) {
      onOverlayRemove?.(survey.id);
    } else {
      onOverlayAdd?.(survey);
    }
  }

  function handleOpacityChange(surveyId: string, e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const opacity = parseInt(target.value, 10);
    onOpacityChange?.(surveyId, opacity);
  }

  function toggleExpanded() {
    expanded = !expanded;
  }
</script>

<div class="survey-selector" role="region" aria-label="Survey overlays">
  <button
    class="toggle-btn"
    onclick={toggleExpanded}
    aria-expanded={expanded}
    aria-label="Toggle survey panel"
    title="Toggle survey overlays panel"
  >
    <span class="toggle-icon">{expanded ? '▼' : '▶'}</span>
    <span class="toggle-label">Survey Overlays</span>
    {#if overlays.length > 0}
      <span class="overlay-count">({overlays.length})</span>
    {/if}
  </button>

  {#if expanded}
    <div class="survey-list" role="group" aria-label="Available surveys">
      {#each SURVEY_OVERLAYS as survey}
        {@const isActive = activeSurveyIds.has(survey.id)}
        {@const overlay = overlays.find(o => o.survey.id === survey.id)}
        <div class="survey-item" class:active={isActive}>
          <label class="survey-label">
            <input
              type="checkbox"
              checked={isActive}
              onchange={() => toggleSurvey(survey)}
              aria-label="Toggle {survey.name}"
            />
            <span class="survey-name">{survey.name}</span>
            <span class="survey-waveband">{survey.waveband}</span>
          </label>
          {#if isActive && overlay}
            <div class="opacity-control">
              <label for="opacity-{survey.id}" class="opacity-label">Opacity</label>
              <input
                id="opacity-{survey.id}"
                type="range"
                min="0"
                max="100"
                value={overlay.opacity}
                oninput={(e) => handleOpacityChange(survey.id, e)}
                title="Overlay opacity: {overlay.opacity}%"
                aria-label="{survey.name} opacity"
              />
              <span class="opacity-value">{overlay.opacity}%</span>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .survey-selector {
    background: #1a1a2e;
    border-bottom: 1px solid #333;
    color: #e0e0e0;
    font-size: 12px;
  }

  .toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: #e0e0e0;
    cursor: pointer;
    text-align: left;
    font-size: 12px;
  }

  .toggle-btn:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .toggle-icon {
    font-size: 10px;
    color: #888;
  }

  .toggle-label {
    font-weight: 600;
  }

  .overlay-count {
    color: #8cf;
    font-size: 11px;
  }

  .survey-list {
    padding: 4px 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .survey-item {
    background: #2a2a3e;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 6px 8px;
  }

  .survey-item.active {
    border-color: #555;
    background: #2a2a4e;
  }

  .survey-label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .survey-label input[type="checkbox"] {
    accent-color: #6a6aff;
  }

  .survey-name {
    font-weight: 600;
    color: #ddd;
  }

  .survey-waveband {
    color: #888;
    font-size: 11px;
    margin-left: auto;
  }

  .opacity-control {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    padding-left: 20px;
  }

  .opacity-label {
    color: #aaa;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    min-width: 40px;
  }

  .opacity-control input[type="range"] {
    flex: 1;
    accent-color: #6a6aff;
    cursor: pointer;
  }

  .opacity-value {
    color: #8cf;
    font-size: 11px;
    min-width: 32px;
    text-align: right;
  }
</style>
