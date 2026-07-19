import { test, expect, Page } from "@playwright/test";

const BASE_API = "http://127.0.0.1:3001/api";
const SEED_PROJECT_NAME = `E2E-Supervisor-${Date.now()}`;
const SEED_PROJECT_PATH = `/tmp/e2e-supervisor-${Date.now()}`;
let seedProjectId: string;

test.beforeAll(async () => {
  const res = await fetch(`${BASE_API}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: SEED_PROJECT_NAME, path: SEED_PROJECT_PATH }),
  });
  const data = await res.json();
  seedProjectId = data.id;
  // A planned, unlinked roadmap item is a supervisor 'roadmap' signal — a scan
  // turns it into exactly one proposal on this isolated E2E DB.
  await fetch(`${BASE_API}/projects/${seedProjectId}/roadmap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Ship the widget API" }),
  });
});

test.afterAll(async () => {
  if (seedProjectId) {
    await fetch(`${BASE_API}/projects/${seedProjectId}`, { method: "DELETE" });
  }
});

async function dismissOnboarding(page: Page) {
  const getStartedBtn = page.getByRole("button", { name: /get started/i });
  if (await getStartedBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await getStartedBtn.click();
    const skipBtn = page.getByRole("button", { name: /skip/i });
    if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) await skipBtn.click();
    const startBtn = page.getByRole("button", { name: /start using vibe kanban/i });
    if (await startBtn.isVisible({ timeout: 2000 }).catch(() => false)) await startBtn.click();
  }
}

// The panel lives inside a Radix Sheet (role="dialog", labelled "Supervisor").
// Scope proposal assertions to it — the emitted task ALSO renders on the Kanban
// board behind the sheet, so an unscoped text match is ambiguous.
async function openSupervisor(page: Page) {
  await page.goto(`/project/${seedProjectId}`, { waitUntil: "networkidle" });
  await dismissOnboarding(page);
  const btn = page.getByRole("button", { name: /^Supervisor$/ });
  await expect(btn).toBeVisible({ timeout: 15000 });
  await btn.click();
  return page.getByRole("dialog", { name: /Supervisor/ });
}

test.describe.serial("Supervisor review panel", () => {
  test("scan surfaces a cross-project proposal in the panel", async ({ page }) => {
    const panel = await openSupervisor(page);
    const scanBtn = panel.getByRole("button", { name: /^Scan$/ });
    await expect(scanBtn).toBeVisible();
    await scanBtn.click();
    // The seeded roadmap item is emitted as a proposal card inside the panel.
    await expect(panel.getByText("Ship the widget API")).toBeVisible({ timeout: 15000 });
  });

  test("dispatch is blocked by the master switch (default OFF)", async ({ page }) => {
    const panel = await openSupervisor(page);
    // Proposal persists from the prior scan (idempotent) — re-scan is a no-op.
    await panel.getByRole("button", { name: /^Scan$/ }).click();
    await expect(panel.getByText("Ship the widget API")).toBeVisible({ timeout: 15000 });
    // Dispatch with the switch off → the server returns 403 → the disabled toast.
    await panel
      .getByRole("button", { name: /^Dispatch$/ })
      .first()
      .click();
    await expect(page.getByText(/Dispatch is disabled/i)).toBeVisible({ timeout: 10000 });
  });
});
