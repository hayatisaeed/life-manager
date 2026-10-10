import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Property tests (merge laws, the recurrence oracle) take seconds each,
    // and longer when `pnpm test` runs every package in parallel alongside the
    // sync simulator. Same runs and assertions; just room to finish.
    testTimeout: 30_000,
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
