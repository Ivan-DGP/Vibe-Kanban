import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const isCI = !!process.env.CI;

// Isolate the dev server's data dir so E2E runs never touch data/vibe-kanban.db.
const E2E_DATA_DIR = path.join(mkdtempSync(path.join(tmpdir(), "vk-e2e-")), "data");

export default defineConfig({
  timeout: 60000,
  retries: isCI ? 1 : 0,
  workers: isCI ? 4 : 1,
  reporter: isCI
    ? [["list"], ["json", { outputFile: "e2e-results.json" }]]
    : [["list"], ["html", { open: "never", outputFolder: "client/e2e/playwright-report" }]],
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      testDir: "./client/e2e",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: isCI ? /ai-resolve/ : undefined,
    },
    {
      name: "bench-e2e",
      testDir: "./benchmarks/e2e",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run dev",
    // Gate readiness on the API server (:3001), not the Vite client (:5173). The API
    // boots slower (runs migrations on a fresh E2E DB), and specs hit it in beforeAll —
    // gating on :5173 races and yields ECONNREFUSED 3001. Once :3001 answers, :5173 is up.
    url: "http://localhost:3001/api/projects",
    reuseExistingServer: false,
    timeout: 120000,
    env: { VK_DATA_DIR: E2E_DATA_DIR },
  },
});
