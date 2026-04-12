import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './client/e2e',
  timeout: 60000,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI
    ? [['list'], ['json', { outputFile: 'e2e-results.json' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'client/e2e/playwright-report' }]],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !isCI,
    timeout: 30000,
  },
});
