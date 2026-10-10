import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/**/*.d.ts'],
      // Every branch in the crypto wrappers is a rejection path someone relies on.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
