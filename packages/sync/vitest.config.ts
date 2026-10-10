import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The convergence simulator runs many devices; give it room.
    testTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/test-support/**', 'src/sim/**'],
      thresholds: { branches: 95, functions: 95, lines: 95, statements: 95 },
    },
  },
});
