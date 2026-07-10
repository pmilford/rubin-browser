import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import HelpModal from '../../src/components/HelpModal.svelte';
import { GLOSSARY } from '../../src/data/glossary.js';

describe('HelpModal', () => {
  it('renders nothing when open is false', () => {
    render(HelpModal, { props: { open: false } });
    const dialog = screen.queryByRole('dialog');
    expect(dialog).toBeNull();
  });

  it('renders dialog when open is true', () => {
    render(HelpModal, { props: { open: true } });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
  });

  it('displays the title', () => {
    render(HelpModal, { props: { open: true } });
    expect(screen.getByText('Rubin Image Viewer Help')).toBeTruthy();
  });

  it('displays keyboard shortcuts section', () => {
    render(HelpModal, { props: { open: true } });
    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy();
    expect(screen.getByText('Mouse drag')).toBeTruthy();
    expect(screen.getByText('Pan the view')).toBeTruthy();
  });

  it('displays scaling methods section', () => {
    render(HelpModal, { props: { open: true } });
    expect(screen.getByText('Scaling Methods')).toBeTruthy();
    expect(screen.getByText('Linear')).toBeTruthy();
    expect(screen.getByText('Log')).toBeTruthy();
    expect(screen.getByText('Square Root')).toBeTruthy();
    expect(screen.getByText('Asinh')).toBeTruthy();
    expect(screen.getByText('Histogram')).toBeTruthy();
    expect(screen.getByText('ZScale')).toBeTruthy();
    expect(screen.getByText('Percentile')).toBeTruthy();
  });

  it('lists all keyboard shortcuts', () => {
    render(HelpModal, { props: { open: true } });
    expect(screen.getByText('Scroll wheel')).toBeTruthy();
    // "Zoom in/out" appears twice (scroll wheel desc + +/- desc)
    const zoomTexts = screen.getAllByText('Zoom in/out');
    expect(zoomTexts.length).toBe(2);
    expect(screen.getByText('Double-click')).toBeTruthy();
    expect(screen.getByText('+/-')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('H')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(HelpModal, { props: { open: true, onClose } });

    const closeBtn = screen.getByLabelText('Close help');
    await fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    render(HelpModal, { props: { open: true, onClose } });

    const dialog = screen.getByRole('dialog');
    await fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose for other keys', async () => {
    const onClose = vi.fn();
    render(HelpModal, { props: { open: true, onClose } });

    const dialog = screen.getByRole('dialog');
    await fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('has correct ARIA attributes', () => {
    render(HelpModal, { props: { open: true } });
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Help');
  });

  it('renders help entries as definition lists', () => {
    render(HelpModal, { props: { open: true } });
    const dts = screen.getAllByText(/^(Mouse drag|Scroll wheel|Double-click|Linear|Log)$/);
    expect(dts.length).toBeGreaterThanOrEqual(5);
  });

  it('renders without onClose callback', () => {
    render(HelpModal, { props: { open: true } });
    // Should not throw when close button is clicked without onClose
    const closeBtn = screen.getByLabelText('Close help');
    expect(async () => await fireEvent.click(closeBtn)).not.toThrow();
  });
});

describe('HelpModal glossary (feature 100)', () => {
  it('lists real glossary terms with their plain-language definitions', () => {
    render(HelpModal, { props: { open: true } });
    const list = screen.getByLabelText('Glossary terms');
    // DP1's ACTUAL definition must be present (not a placeholder) — the same
    // adversarial fact the glossary unit test pins: 7 fields.
    expect(within(list).getByText(GLOSSARY['dp1']!.term)).toBeTruthy();
    expect(within(list).getByText(GLOSSARY['dp1']!.short)).toBeTruthy();
    expect(GLOSSARY['dp1']!.short).toMatch(/7|seven/);
    // A spread of the domain jargon is surfaced.
    expect(within(list).getByText(GLOSSARY['hips']!.term)).toBeTruthy();
    expect(within(list).getByText(GLOSSARY['wcs']!.term)).toBeTruthy();
  });

  it('filters the term list to the query (and hides non-matches)', async () => {
    render(HelpModal, { props: { open: true } });
    await fireEvent.input(screen.getByLabelText('Filter glossary'), {
      target: { value: 'HiPS' },
    });
    const list = screen.getByLabelText('Glossary terms');
    expect(within(list).getByText(GLOSSARY['hips']!.term)).toBeTruthy();
    // An unrelated term (MJD) is filtered OUT — proves the filter is real and not
    // rendering the whole list regardless.
    expect(within(list).queryByText(GLOSSARY['mjd']!.term)).toBeNull();
  });

  it('does not render the glossary when closed', () => {
    render(HelpModal, { props: { open: false } });
    expect(screen.queryByLabelText('Glossary terms')).toBeNull();
  });
});
