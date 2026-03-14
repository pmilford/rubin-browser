import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SurveySelector from '../../src/components/SurveySelector.svelte';
import { SURVEY_OVERLAYS } from '../../src/constants.js';

describe('SurveySelector', () => {
  describe('rendering', () => {
    it('renders the survey selector region', () => {
      render(SurveySelector);
      expect(screen.getByRole('region', { name: 'Survey overlays' })).toBeTruthy();
    });

    it('renders the toggle button', () => {
      render(SurveySelector);
      expect(screen.getByLabelText('Toggle survey panel')).toBeTruthy();
    });

    it('shows collapsed state by default', () => {
      render(SurveySelector);
      const btn = screen.getByLabelText('Toggle survey panel');
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('does not show survey list when collapsed', () => {
      render(SurveySelector);
      expect(screen.queryByRole('group', { name: 'Available surveys' })).toBeNull();
    });

    it('does not show overlay count when no overlays', () => {
      render(SurveySelector);
      expect(screen.queryByText(/\(\d+\)/)).toBeNull();
    });
  });

  describe('expanding and collapsing', () => {
    it('expands when toggle button is clicked', async () => {
      render(SurveySelector);
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));
      expect(screen.getByLabelText('Toggle survey panel').getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByRole('group', { name: 'Available surveys' })).toBeTruthy();
    });

    it('collapses on second click', async () => {
      render(SurveySelector);
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));
      expect(screen.getByLabelText('Toggle survey panel').getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('group', { name: 'Available surveys' })).toBeNull();
    });
  });

  describe('survey list', () => {
    it('renders all surveys when expanded', async () => {
      render(SurveySelector);
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      for (const survey of SURVEY_OVERLAYS) {
        expect(screen.getByLabelText(`Toggle ${survey.name}`)).toBeTruthy();
      }
    });

    it('displays survey names and wavebands', async () => {
      render(SurveySelector);
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      expect(screen.getByText('Gaia DR3')).toBeTruthy();
      expect(screen.getByText('Optical (G band)')).toBeTruthy();
      expect(screen.getByText('DSS2 Color')).toBeTruthy();
      expect(screen.getByText('2MASS J')).toBeTruthy();
      expect(screen.getByText('SDSS Color')).toBeTruthy();
    });

    it('has all surveys unchecked by default', async () => {
      render(SurveySelector);
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      for (const survey of SURVEY_OVERLAYS) {
        const checkbox = screen.getByLabelText(`Toggle ${survey.name}`) as HTMLInputElement;
        expect(checkbox.checked).toBe(false);
      }
    });
  });

  describe('toggle overlays', () => {
    it('calls onOverlayAdd when checking a survey', async () => {
      const onOverlayAdd = vi.fn();
      render(SurveySelector, { props: { onOverlayAdd } });
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      await fireEvent.click(screen.getByLabelText('Toggle Gaia DR3'));
      expect(onOverlayAdd).toHaveBeenCalledWith(SURVEY_OVERLAYS[0]);
    });

    it('calls onOverlayRemove when unchecking a survey', async () => {
      const onOverlayRemove = vi.fn();
      const overlays = [{ survey: SURVEY_OVERLAYS[0], opacity: 80 }];
      render(SurveySelector, { props: { overlays, onOverlayRemove } });
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      await fireEvent.click(screen.getByLabelText('Toggle Gaia DR3'));
      expect(onOverlayRemove).toHaveBeenCalledWith('gaia-dr3');
    });

    it('shows overlay count in toggle button', async () => {
      const overlays = [
        { survey: SURVEY_OVERLAYS[0], opacity: 80 },
        { survey: SURVEY_OVERLAYS[1], opacity: 60 },
      ];
      render(SurveySelector, { props: { overlays } });
      expect(screen.getByText('(2)')).toBeTruthy();
    });

    it('shows survey as checked when in overlays list', async () => {
      const overlays = [{ survey: SURVEY_OVERLAYS[0], opacity: 80 }];
      render(SurveySelector, { props: { overlays } });
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      const checkbox = screen.getByLabelText('Toggle Gaia DR3') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('handles multiple active overlays', async () => {
      const overlays = [
        { survey: SURVEY_OVERLAYS[0], opacity: 80 },
        { survey: SURVEY_OVERLAYS[2], opacity: 50 },
      ];
      render(SurveySelector, { props: { overlays } });
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      expect((screen.getByLabelText('Toggle Gaia DR3') as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText('Toggle DSS2 Color') as HTMLInputElement).checked).toBe(false);
      expect((screen.getByLabelText('Toggle 2MASS J') as HTMLInputElement).checked).toBe(true);
    });
  });

  describe('opacity control', () => {
    it('shows opacity slider for active survey', async () => {
      const overlays = [{ survey: SURVEY_OVERLAYS[0], opacity: 80 }];
      render(SurveySelector, { props: { overlays } });
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      expect(screen.getByLabelText('Gaia DR3 opacity')).toBeTruthy();
      expect(screen.getByText('80%')).toBeTruthy();
    });

    it('does not show opacity slider for inactive survey', async () => {
      render(SurveySelector);
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      expect(screen.queryByLabelText('Gaia DR3 opacity')).toBeNull();
    });

    it('calls onOpacityChange when slider changes', async () => {
      const onOpacityChange = vi.fn();
      const overlays = [{ survey: SURVEY_OVERLAYS[0], opacity: 80 }];
      render(SurveySelector, { props: { overlays, onOpacityChange } });
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      const slider = screen.getByLabelText('Gaia DR3 opacity');
      await fireEvent.input(slider, { target: { value: '50' } });
      expect(onOpacityChange).toHaveBeenCalledWith('gaia-dr3', 50);
    });

    it('shows opacity value for each active overlay', async () => {
      const overlays = [
        { survey: SURVEY_OVERLAYS[0], opacity: 80 },
        { survey: SURVEY_OVERLAYS[1], opacity: 40 },
      ];
      render(SurveySelector, { props: { overlays } });
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      expect(screen.getByText('80%')).toBeTruthy();
      expect(screen.getByText('40%')).toBeTruthy();
    });

    it('opacity slider range is 0-100', async () => {
      const overlays = [{ survey: SURVEY_OVERLAYS[0], opacity: 80 }];
      render(SurveySelector, { props: { overlays } });
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));

      const slider = screen.getByLabelText('Gaia DR3 opacity') as HTMLInputElement;
      expect(slider.min).toBe('0');
      expect(slider.max).toBe('100');
    });
  });

  describe('without callbacks', () => {
    it('handles toggle without onOverlayAdd', async () => {
      render(SurveySelector);
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));
      await fireEvent.click(screen.getByLabelText('Toggle Gaia DR3'));
      // Should not throw
    });

    it('handles uncheck without onOverlayRemove', async () => {
      const overlays = [{ survey: SURVEY_OVERLAYS[0], opacity: 80 }];
      render(SurveySelector, { props: { overlays } });
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));
      await fireEvent.click(screen.getByLabelText('Toggle Gaia DR3'));
      // Should not throw
    });

    it('handles opacity change without onOpacityChange', async () => {
      const overlays = [{ survey: SURVEY_OVERLAYS[0], opacity: 80 }];
      render(SurveySelector, { props: { overlays } });
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));
      const slider = screen.getByLabelText('Gaia DR3 opacity');
      await fireEvent.input(slider, { target: { value: '50' } });
      // Should not throw
    });

    it('handles expand/collapse without overlays', async () => {
      render(SurveySelector);
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));
      await fireEvent.click(screen.getByLabelText('Toggle survey panel'));
      // Should not throw
    });
  });
});
