import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
      // ROADMAP P0.3 AC: 100% branch coverage on merge, HLC and recurrence.
      // The other primitives are held to the same bar while they're small.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
