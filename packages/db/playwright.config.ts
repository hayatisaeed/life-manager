import { defineConfig, devices } from '@playwright/test';

// Runs the repository suite in Chromium (ROADMAP P0.5 AC). Cloud sessions set
// PW_CHROMIUM_PATH; CI installs Playwright's browser.
const executablePath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4174',
    ...devices['Desktop Chrome'],
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: 'vite build --config e2e/vite.config.ts && vite preview --config e2e/vite.config.ts',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
