// ESLint flat config (ESLint 10 — the only supported format).
// Previously absent, so `npm run lint` could not run at all. This gives a
// practical correctness baseline over TS + Svelte; ratchet rule strictness up
// over time rather than starting strict-and-red.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      'test-results/',
      'playwright-report/',
      'tests/ui/__snapshots__/',
      'tests/ui/screenshots/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Allow intentional throwaway/underscore-prefixed args and vars.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` is discouraged by CLAUDE.md but flagged, not fatal, during restart.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Prefer @ts-expect-error — surfaced as a warning to ratchet later.
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
  {
    // Svelte components use `<script lang="ts">`; the Svelte parser must hand
    // those blocks to the TS parser or every type annotation is a parse error.
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      'svelte/no-at-html-tags': 'warn',
      // Opinionated Svelte rules surfaced as warnings for this restart baseline —
      // ratchet to 'error' as components are cleaned up. Notably
      // prefer-svelte-reactivity MISFIRES here: ImageViewer's tileCache/overlays/
      // pendingLoads Maps & Sets are DELIBERATELY non-reactive plain caches;
      // converting them to SvelteMap/SvelteSet would add unwanted reactivity.
      'svelte/require-each-key': 'warn',
      'svelte/prefer-svelte-reactivity': 'warn',
      'svelte/no-unused-svelte-ignore': 'warn',
    },
  },
  {
    // Test files use non-null assertions heavily against known-good fixtures.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
);
