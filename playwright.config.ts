import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const isCI = !!process.env.CI;

// Isolate the dev server's data dir so E2E runs never touch data/vibe-kanban.db.
const E2E_DATA_DIR = path.join(mkdtempSync(path.join(tmpdir(), 'vk-e2e-')), 'data');

export default defineConfig({
  testDir: './client/e2e',
  timeout: 60000,
  retries: isCI ? 1 : 0,
  workers: isCI ? 4 : 1,
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
      testIgnore: isCI ? /ai-resolve/ : undefined,
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 30000,
    env: { VK_DATA_DIR: E2E_DATA_DIR },
  },
});
