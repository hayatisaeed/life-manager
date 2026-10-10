import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The property tests (merge, recurrence oracle) run hundreds of cases;
    // with every package testing in parallel they can pass Vitest's 5 s default.
    testTimeout: 60_000,
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
