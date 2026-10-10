import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/sync/merge.ts', 'src/ids/hlc.ts', 'src/recurrence/**'],
      // ROADMAP P0.3 AC: 100% branch coverage on merge, HLC and recurrence.
      thresholds: { branches: 100 },
    },
  },
});
