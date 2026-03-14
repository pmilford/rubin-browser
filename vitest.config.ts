import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/main.ts', 'src/components/**', 'src/views/**'],
      thresholds: {
        branches: 95,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    include: ['tests/**/*.test.ts'],
  },
});
