import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e/ is run by Playwright (`pnpm test:e2e`), not Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
