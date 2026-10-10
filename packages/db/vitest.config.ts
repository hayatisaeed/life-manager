import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e/ holds the Playwright browser suite.
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The worker entry and the OPFS opener only run in a browser; the
      // Playwright suite (e2e/) covers them.
      exclude: [
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/**/*.d.ts',
        'src/web/**',
        'src/test-support/**',
      ],
      thresholds: { branches: 95, functions: 95, lines: 95, statements: 95 },
    },
  },
});
