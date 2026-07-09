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
      exclude: ['src/main.ts'],
      // Floor, not a target — ratchet UP as real coverage improves; never lower
      // to sneak a commit past. These were recalibrated for @vitest/coverage-v8
      // v4, whose AST-aware remapping counts .svelte branches more strictly than
      // v3 did (branches ~72% vs the old ~87% for identical code). Pure src/*.ts
      // files remain 90–100%; the gap is untested Svelte event handlers. Real
      // rendering/interaction confidence comes from the Playwright visual +
      // geometry layers, not this number (see CLAUDE.md "Testing Philosophy").
      thresholds: {
        branches: 71,
        functions: 78,
        lines: 79,
        statements: 80,
      },
    },
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
