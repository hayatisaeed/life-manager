import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-utils.ts', 'src/index.ts', 'src/env.ts'],
      // ROADMAP P0.3 AC: 100% branch coverage on merge, HLC and recurrence.
      thresholds: { 'src/hlc.ts': { branches: 100, functions: 100, lines: 100, statements: 100 } },
    },
  },
});
