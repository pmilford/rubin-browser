import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ['browser'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,svelte}'],
      // ImageViewer + TileViewer are canvas-driven: their behaviour is the PIXELS
      // they paint and the drag/zoom outcomes, which jsdom cannot observe (the 2D
      // context is mocked in tests/setup.ts — see CLAUDE.md "Test rendering by its
      // OUTCOME, never by mocks"). Their real coverage is the Playwright visual +
      // interaction suite (base-fallback, interaction-outcomes, graticule, ruler,
      // nav-permalink, dia-source, alerts, offline-multiepoch, …). Counting their
      // jsdom line-coverage here would only reward meaningless mock tests, so they
      // are scoped OUT of the UNIT-coverage floor. Every other .svelte component
      // renders SVG/DOM and IS meaningfully unit-tested and in-scope.
      exclude: [
        'src/main.ts',
        'src/components/ImageViewer.svelte',
        'src/views/TileViewer.svelte',
      ],
      // Floor, not a target — ratchet UP as real coverage improves; never lower
      // to sneak a commit past. These were recalibrated for @vitest/coverage-v8
      // v4, whose AST-aware remapping counts .svelte branches more strictly than
      // v3 did (branches ~72% vs the old ~87% for identical code). Pure src/*.ts
      // files remain 90–100%; the gap is untested Svelte event handlers. Real
      // rendering/interaction confidence comes from the Playwright visual +
      // geometry layers, not this number (see CLAUDE.md "Testing Philosophy").
      // Ratcheted UP after scoping out the two canvas viewers (Playwright-covered)
      // and unit-testing the SVG presentational components. Actuals at this commit:
      // stmts 90.7 / branches 82.5 / funcs 86.9 / lines 93.7 — floors sit just
      // below with a small margin. Ratchet UP as coverage improves; never down.
      thresholds: {
        branches: 80,
        functions: 84,
        lines: 90,
        statements: 88,
      },
    },
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
