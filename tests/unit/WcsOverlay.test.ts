import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import WcsOverlay from '../../src/components/WcsOverlay.svelte';

afterEach(cleanup);

describe('WcsOverlay', () => {
  describe('rendering', () => {
    it('renders the WCS overlay', () => {
      render(WcsOverlay);
      expect(screen.getByRole('img', { name: 'WCS overlay' })).toBeTruthy();
    });

    it('renders grid section by default', () => {
      render(WcsOverlay);
      expect(screen.getByText('Grid')).toBeTruthy();
    });

    it('renders N/E indicator by default', () => {
      render(WcsOverlay);
      expect(screen.getByText('N')).toBeTruthy();
      expect(screen.getByText('E')).toBeTruthy();
    });

    it('renders scale bar by default', () => {
      render(WcsOverlay);
      const barLabel = document.querySelector('.bar-label');
      expect(barLabel).toBeTruthy();
      expect(barLabel!.textContent!.length).toBeGreaterThan(0);
    });

    it('shows grid spacing based on FOV', () => {
      render(WcsOverlay, { props: { fovDeg: 15 } });
      expect(screen.getByText('2° spacing')).toBeTruthy();
    });

    it('shows larger spacing for wide FOV', () => {
      render(WcsOverlay, { props: { fovDeg: 50 } });
      expect(screen.getByText('10° spacing')).toBeTruthy();
    });

    it('shows smaller spacing for narrow FOV', () => {
      render(WcsOverlay, { props: { fovDeg: 0.3 } });
      expect(screen.getByText('0.05° spacing')).toBeTruthy();
    });
  });

  describe('grid lines', () => {
    it('generates RA grid lines', () => {
      render(WcsOverlay, { props: { ra: 60, fovDeg: 10, showGrid: true } });
      expect(screen.getByText('RA:')).toBeTruthy();
    });

    it('generates Dec grid lines', () => {
      render(WcsOverlay, { props: { dec: -30, fovDeg: 10, showGrid: true } });
      expect(screen.getByText('Dec:')).toBeTruthy();
    });

    it('shows ellipsis when many lines', () => {
      const { container } = render(WcsOverlay, { props: { ra: 60, dec: -30, fovDeg: 100, showGrid: true } });
      // With 100° FOV and 10° spacing, we get > 5 lines per axis
      const ellipsis = container.querySelector('.coord-ellipsis');
      expect(ellipsis).toBeTruthy();
    });

    it('does not show ellipsis for few lines', () => {
      // fovDeg=0.25 → spacing=0.05° → 5 lines per axis (no ellipsis threshold is > 5)
      const { container } = render(WcsOverlay, { props: { ra: 60, dec: -30, fovDeg: 0.25, showGrid: true } });
      const ellipsis = container.querySelector('.coord-ellipsis');
      expect(ellipsis).toBeNull();
    });
  });

  describe('toggle visibility', () => {
    it('hides grid when showGrid is false', () => {
      render(WcsOverlay, { props: { showGrid: false } });
      expect(screen.queryByText('Grid')).toBeNull();
    });

    it('hides N/E indicator when showNE is false', () => {
      render(WcsOverlay, { props: { showNE: false } });
      expect(screen.queryByText('N')).toBeNull();
      expect(screen.queryByText('E')).toBeNull();
    });

    it('hides scale bar when showScale is false', () => {
      render(WcsOverlay, { props: { showScale: false } });
      // The bar-label contains the formatted scale bar
      const barLabel = document.querySelector('.bar-label');
      expect(barLabel).toBeNull();
    });

    it('shows only N/E when grid and scale are hidden', () => {
      render(WcsOverlay, { props: { showGrid: false, showScale: false } });
      expect(screen.getByText('N')).toBeTruthy();
      expect(screen.getByText('E')).toBeTruthy();
      expect(screen.queryByText('Grid')).toBeNull();
    });
  });

  describe('coordinate formatting', () => {
    it('formats RA in hours/minutes', () => {
      // With fovDeg=25, spacing=5°. Center ra=75 → grid lines include 75° = 5h00m
      render(WcsOverlay, { props: { ra: 75, dec: 0, fovDeg: 25, showGrid: true } });
      expect(screen.getByText('5h00m')).toBeTruthy();
    });

    it('formats Dec with degree/arcmin', () => {
      // With fovDeg=25, spacing=5°. Center dec=30 → grid lines include +30°00'
      render(WcsOverlay, { props: { ra: 0, dec: 30, fovDeg: 25, showGrid: true } });
      expect(screen.getByText('+30°00\'')).toBeTruthy();
    });

    it('formats negative Dec', () => {
      // With fovDeg=25, spacing=5°. Center dec=-45 → grid lines include -45°00'
      render(WcsOverlay, { props: { ra: 0, dec: -45, fovDeg: 25, showGrid: true } });
      expect(screen.getByText('-45°00\'')).toBeTruthy();
    });
  });

  describe('grid spacing computation', () => {
    // Matches computeGridSpacing() in WcsOverlay.svelte:
    // fov > 40 → 10, > 20 → 5, > 10 → 2, > 5 → 1, > 2 → 0.5,
    // > 1 → 0.2, > 0.5 → 0.1, > 0.2 → 0.05, else → 0.02
    const testCases = [
      { fov: 50, expected: '10°' },
      { fov: 25, expected: '5°' },
      { fov: 15, expected: '2°' },
      { fov: 12, expected: '2°' },
      { fov: 6, expected: '1°' },
      { fov: 3, expected: '0.5°' },
      { fov: 1.5, expected: '0.2°' },
      { fov: 0.8, expected: '0.1°' },
      { fov: 0.3, expected: '0.05°' },
      { fov: 0.1, expected: '0.02°' },
    ];

    for (const { fov, expected } of testCases) {
      it(`computes ${expected} spacing for ${fov}° FOV`, () => {
        render(WcsOverlay, { props: { fovDeg: fov } });
        expect(screen.getByText(`${expected} spacing`)).toBeTruthy();
      });
    }
  });

  describe('N/E arrows', () => {
    it('shows north arrow pointing up', () => {
      render(WcsOverlay, { props: { showNE: true } });
      expect(screen.getByText('↑')).toBeTruthy();
    });

    it('shows east arrow pointing left (standard convention)', () => {
      render(WcsOverlay, { props: { showNE: true } });
      expect(screen.getByText('←')).toBeTruthy();
    });
  });

  describe('scale bar', () => {
    it('shows scale bar for moderate FOV', () => {
      render(WcsOverlay, { props: { fovDeg: 5, showScale: true } });
      const barLabel = document.querySelector('.bar-label');
      expect(barLabel).toBeTruthy();
      expect(barLabel!.textContent).toMatch(/['°]/);
    });

    it('shows degrees for wide FOV', () => {
      render(WcsOverlay, { props: { fovDeg: 50, showScale: true } });
      const barLabel = document.querySelector('.bar-label');
      expect(barLabel!.textContent).toContain('°');
    });

    it('shows arcminutes for narrow FOV', () => {
      render(WcsOverlay, { props: { fovDeg: 0.5, showScale: true } });
      const barLabel = document.querySelector('.bar-label');
      expect(barLabel!.textContent).toContain('\'');
    });
  });
});
