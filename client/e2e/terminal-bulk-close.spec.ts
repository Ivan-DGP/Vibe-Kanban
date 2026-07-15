import { test, expect, Page } from "@playwright/test";

const BASE_API = "http://127.0.0.1:3001/api";
const SEED_PROJECT_NAME = `E2E-TermClose-${Date.now()}`;
const SEED_PROJECT_PATH = `/tmp/e2e-termclose-${Date.now()}`;
let seedProjectId: string;

test.beforeAll(async () => {
  const res = await fetch(`${BASE_API}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: SEED_PROJECT_NAME, path: SEED_PROJECT_PATH }),
  });
  const data = await res.json();
  seedProjectId = data.id;
});

test.afterAll(async () => {
  if (seedProjectId) {
    await fetch(`${BASE_API}/projects/${seedProjectId}`, { method: "DELETE" });
  }
});

// Sessions are server-side and persist across tests. Kill every one before
// each test so counts start from a clean slate.
async function killAllSessions() {
  const res = await fetch(`${BASE_API}/terminal/sessions`);
  const sessions: { id: string }[] = await res.json();
  for (const s of sessions) {
    await fetch(`${BASE_API}/terminal/sessions/${s.id}`, { method: "DELETE" });
  }
}

test.beforeEach(async () => {
  await killAllSessions();
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

const tabs = (page: Page) => page.locator('[role="tab"]');

async function openTerminal(page: Page) {
  const toggle = page.getByRole("button", { name: /^Terminal$/ });
  if (await toggle.isVisible({ timeout: 3000 }).catch(() => false)) {
    await toggle.click();
  }
}

// Seed sessions via the API (stable) rather than driving the flaky Radix
// dropdown. The UI polls /terminal/sessions and renders these as tabs — the
// close controls under test then operate on real server sessions.
async function createSessions(page: Page, n: number) {
  const start = await tabs(page).count();
  for (let i = 0; i < n; i++) {
    const res = await fetch(`${BASE_API}/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // No projectId: falls back to the server cwd (the seed project path
      // isn't a real dir on disk, which would fail the PTY spawn).
      body: JSON.stringify({ type: "shell" }),
    });
    if (!res.ok) throw new Error(`create session failed: ${res.status}`);
  }
  await expect(tabs(page)).toHaveCount(start + n, { timeout: 15000 });
}

test.describe.serial("Terminal bulk-close controls", () => {
  test("close-all trash button removes every tab", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await dismissOnboarding(page);
    await openTerminal(page);

    await createSessions(page, 4);
    await page.screenshot({ path: "/tmp/claude-1002/term-4tabs.png" });
    await expect(tabs(page)).toHaveCount(4);

    // Trash button appears only when >1 session
    const trash = page.locator('button[title="Close all terminals"]');
    await expect(trash).toBeVisible();
    await trash.click();

    await expect(tabs(page)).toHaveCount(0, { timeout: 10000 });
  });

  test("context menu: Close to the Right", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await dismissOnboarding(page);
    await openTerminal(page);
    await createSessions(page, 4);

    // Right-click the 2nd tab -> Close to the Right should leave 2 tabs
    await tabs(page).nth(1).click({ button: "right" });
    await page.screenshot({ path: "/tmp/claude-1002/term-contextmenu.png" });
    const rightItem = page.getByRole("menuitem", { name: /Close to the Right/ });
    await expect(rightItem).toBeVisible();
    await rightItem.click();
    await expect(tabs(page)).toHaveCount(2, { timeout: 10000 });
  });

  test("context menu: Close to the Left", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await dismissOnboarding(page);
    await openTerminal(page);
    await createSessions(page, 4);

    // Right-click the 3rd tab (index 2) -> Close to the Left removes 2 -> 2 remain
    await tabs(page).nth(2).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Close to the Left/ }).click();
    await expect(tabs(page)).toHaveCount(2, { timeout: 10000 });
  });

  test("context menu: Close Others keeps only the target", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await dismissOnboarding(page);
    await openTerminal(page);
    await createSessions(page, 4);

    const keepName = await tabs(page).nth(1).innerText();
    await tabs(page).nth(1).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Close Others/ }).click();
    await expect(tabs(page)).toHaveCount(1, { timeout: 10000 });
    // Surviving tab is the one we kept
    expect(await tabs(page).first().innerText()).toBe(keepName);
  });

  test("context menu: positional items disabled at edges", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await dismissOnboarding(page);
    await openTerminal(page);
    await createSessions(page, 3);

    // First tab: "Close to the Left" must be disabled
    await tabs(page).first().click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: /Close to the Left/ })).toBeDisabled();
    await expect(page.getByRole("menuitem", { name: /Close to the Right/ })).toBeEnabled();
    await page.keyboard.press("Escape");

    // Last tab: "Close to the Right" must be disabled
    await tabs(page).last().click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: /Close to the Right/ })).toBeDisabled();
    await page.keyboard.press("Escape");

    // cleanup
    await page.locator('button[title="Close all terminals"]').click();
    await expect(tabs(page)).toHaveCount(0, { timeout: 10000 });
  });
});
