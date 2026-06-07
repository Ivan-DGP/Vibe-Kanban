import { test, expect, type Page } from "@playwright/test";

const BASE_API = "http://localhost:3001/api";
const FIXTURE_ID = "01-bug-fix-arithmetic";
const RUN_BUDGET_MS = 30000;
const FIRST_LOG_BUDGET_MS = 5000;

interface TriggerResponse {
  runId: string;
  startedAt: string;
  args: string[];
  fixtures: string[];
  spawned: boolean;
}

async function triggerBenchRun(): Promise<TriggerResponse> {
  const res = await fetch(`${BASE_API}/benchmarks/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fixtures: [FIXTURE_ID],
      mock: true,
      mockClaude: true,
      mode: "pipeline",
    }),
  });
  if (!res.ok) throw new Error(`trigger failed: ${res.status}`);
  return (await res.json()) as TriggerResponse;
}

async function dismissOnboarding(page: Page) {
  const getStartedBtn = page.getByRole("button", { name: /get started/i });
  if (await getStartedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await getStartedBtn.click();
    const skipBtn = page.getByRole("button", { name: /skip/i });
    if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await skipBtn.click();
    }
    const startBtn = page.getByRole("button", { name: /start using vibe kanban/i });
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startBtn.click();
    }
  }
}

test.describe("Bench-E2E: kanban-style live tail of a bench run", () => {
  test.beforeEach(async ({ page }) => {
    page.setDefaultTimeout(15000);
    // Dismiss the onboarding wizard up front. Each test gets a fresh context,
    // so a test that navigates straight to /benchmarks would otherwise have the
    // wizard's dialog-overlay intercept its clicks.
    await page.goto("/", { waitUntil: "networkidle" });
    await dismissOnboarding(page);
  });

  test("trigger run via API → row appears → live tail streams logs → terminal status", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await dismissOnboarding(page);
    await page.goto("/benchmarks", { waitUntil: "networkidle" });

    const t0 = Date.now();
    const triggered = await triggerBenchRun();
    expect(triggered.runId).toMatch(/^[a-f0-9]+$/);

    const activeHeading = page.getByRole("heading", { name: /active runs/i });
    await expect(activeHeading).toBeVisible({ timeout: 5000 });

    const row = page.locator(`text=${triggered.runId}`).first();
    await expect(row).toBeVisible({ timeout: 5000 });

    const rowAppearedAt = Date.now();
    expect(rowAppearedAt - t0).toBeLessThan(5000);

    await row.click();

    const tailBox = page.locator('div[class*="font-mono"][class*="overflow-auto"]').last();
    await expect(tailBox).toBeVisible({ timeout: 3000 });

    await expect(tailBox).toContainText(/benchmark run/i, { timeout: FIRST_LOG_BUDGET_MS });
    const firstLogAt = Date.now();
    expect(firstLogAt - t0).toBeLessThan(FIRST_LOG_BUDGET_MS + 5000);

    await expect(tailBox).toContainText(/exit\s+0/i, { timeout: RUN_BUDGET_MS });

    const doneBadge = page
      .locator('span:has-text("done")')
      .filter({ hasText: /^done$/ })
      .first();
    await expect(doneBadge).toBeVisible({ timeout: 5000 });

    const finishedAt = Date.now();
    const e2eMs = finishedAt - t0;
    expect(e2eMs).toBeLessThan(RUN_BUDGET_MS);

    test.info().annotations.push({ type: "e2eMs", description: String(e2eMs) });
    test.info().annotations.push({
      type: "rowAppearMs",
      description: String(rowAppearedAt - t0),
    });
  });

  test("re-connecting to a finished run replays buffered lines", async ({ page }) => {
    const triggered = await triggerBenchRun();

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const r = await fetch(`${BASE_API}/benchmarks/active`).then((r) => r.json());
      const row = (r.runs as { runId: string; status: string }[]).find(
        (x) => x.runId === triggered.runId,
      );
      if (row && row.status !== "running") break;
      await new Promise((res) => setTimeout(res, 300));
    }

    await page.goto("/benchmarks", { waitUntil: "networkidle" });
    const row = page.locator(`text=${triggered.runId}`).first();
    await expect(row).toBeVisible({ timeout: 8000 });
    await row.click();

    const tailBox = page.locator('div[class*="font-mono"][class*="overflow-auto"]').last();
    await expect(tailBox).toBeVisible({ timeout: 3000 });
    await expect(tailBox).toContainText(/benchmark run/i, { timeout: 4000 });
    await expect(tailBox).toContainText(/exit\s+0/i, { timeout: 4000 });
  });
});
