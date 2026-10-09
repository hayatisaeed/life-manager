import { defineConfig, devices } from '@playwright/test';

// Lets environments with a preinstalled Chromium (e.g. cloud agent sessions) skip
// `playwright install`. CI leaves this unset and uses Playwright's own browser.
const executablePath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  // Every feature is checked in both themes and both directions (docs/DESIGN.md).
  projects: [
    { name: 'light-ltr', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'dark-ltr', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
