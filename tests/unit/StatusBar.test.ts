import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import StatusBar from '../../src/components/StatusBar.svelte';

describe('StatusBar', () => {
  it('renders with default props', () => {
    render(StatusBar);
    const status = screen.getByRole('status');
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('RA:');
    expect(status.textContent).toContain('Dec:');
    expect(status.textContent).toContain('Zoom:');
  });

  it('displays RA in hours format', () => {
    render(StatusBar, { props: { ra: 60 } });
    // 60° / 15 = 4h 0m 0s
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('4h');
    expect(status.textContent).toContain('0m');
  });

  it('displays positive Dec with + sign', () => {
    render(StatusBar, { props: { dec: 45 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('+45');
  });

  it('displays negative Dec with - sign', () => {
    render(StatusBar, { props: { dec: -37 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('-37');
  });

  it('formats RA at 0 degrees', () => {
    render(StatusBar, { props: { ra: 0 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('0h');
  });

  it('formats Dec at 0 degrees', () => {
    render(StatusBar, { props: { dec: 0 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('+0');
  });

  it('displays zoom level with one decimal', () => {
    render(StatusBar, { props: { zoomLevel: 3.7 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('3.7');
  });

  it('displays integer zoom as 1 decimal', () => {
    render(StatusBar, { props: { zoomLevel: 5 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('5.0');
  });

  it('shows pixel value in exponential notation when provided', () => {
    render(StatusBar, { props: { pixelValue: 1234.5 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Val:');
    // toExponential(3) format
    expect(status.textContent).toContain('e+');
  });

  it('hides pixel value when undefined', () => {
    render(StatusBar, { props: { pixelValue: undefined } });
    const status = screen.getByRole('status');
    expect(status.textContent).not.toContain('Val:');
  });

  it('shows pixel value of 0', () => {
    render(StatusBar, { props: { pixelValue: 0 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Val:');
  });

  it('displays message when provided', () => {
    render(StatusBar, { props: { message: 'Loading tiles...' } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Loading tiles...');
  });

  it('hides message when empty', () => {
    render(StatusBar, { props: { message: '' } });
    const status = screen.getByRole('status');
    // The message span should not appear or be empty
    const msgSpans = status.querySelectorAll('.message');
    expect(msgSpans.length).toBe(0);
  });

  it('formats large RA values', () => {
    render(StatusBar, { props: { ra: 359.99 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('RA:');
    // 359.99° / 15 = 23h 59m ...
    expect(status.textContent).toContain('23h');
  });

  it('formats large positive Dec', () => {
    render(StatusBar, { props: { dec: 89.5 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('+89');
  });

  it('formats large negative Dec', () => {
    render(StatusBar, { props: { dec: -89.5 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('-89');
  });

  it('has correct ARIA attributes', () => {
    render(StatusBar);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('renders all coordinate elements', () => {
    render(StatusBar, { props: { ra: 62, dec: -37, zoomLevel: 3 } });
    const coords = screen.getAllByTitle(/Right Ascension|Declination|Current zoom level/);
    expect(coords.length).toBe(3);
  });

  it('handles very small RA values with seconds', () => {
    render(StatusBar, { props: { ra: 0.001 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('RA:');
    expect(status.textContent).toContain('0h');
  });

  it('handles pixel value as 1', () => {
    render(StatusBar, { props: { pixelValue: 1 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Val:');
    expect(status.textContent).toContain('1.000e+0');
  });

  it('handles negative pixel value', () => {
    render(StatusBar, { props: { pixelValue: -5 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Val:');
    expect(status.textContent).toContain('-5');
  });

  it('shows pixel value without message', () => {
    render(StatusBar, { props: { pixelValue: 0.5, message: '' } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Val:');
    expect(status.querySelector('.message')).toBeFalsy();
  });

  it('shows message without pixel value', () => {
    render(StatusBar, { props: { message: 'Ready', pixelValue: undefined } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Ready');
    expect(status.textContent).not.toContain('Val:');
  });

  it('handles very small pixel value with negative exponent', () => {
    render(StatusBar, { props: { pixelValue: 0.001 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Val:');
    expect(status.textContent).toContain('e-');
  });

  it('handles both pixel value and message together', () => {
    render(StatusBar, { props: { pixelValue: 42, message: 'Processing' } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Val:');
    expect(status.textContent).toContain('Processing');
  });

  it('does not render pixel span when pixelValue is undefined', () => {
    render(StatusBar, { props: { pixelValue: undefined } });
    const pixelSpan = document.querySelector('.pixel');
    expect(pixelSpan).toBeFalsy();
  });

  it('does not render message span when message is empty', () => {
    render(StatusBar, { props: { message: '' } });
    const msgSpan = document.querySelector('.message');
    expect(msgSpan).toBeFalsy();
  });

  it('handles negative RA values', () => {
    render(StatusBar, { props: { ra: -30 } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('RA:');
  });
});
