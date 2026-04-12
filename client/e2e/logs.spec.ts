import { test, expect, Page } from "@playwright/test";

/**
 * Dismiss the onboarding wizard if it appears.
 */
async function dismissOnboarding(page: Page) {
  const getStartedBtn = page.getByRole("button", { name: /get started/i });
  if (await getStartedBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await getStartedBtn.click();
    const skipBtn = page.getByRole("button", { name: /skip/i });
    if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipBtn.click();
    }
    const startBtn = page.getByRole("button", {
      name: /start using vibe kanban/i,
    });
    if (await startBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startBtn.click();
    }
  }
}

/**
 * Generate log entries by triggering server actions that produce logs.
 * Creates a project and some tasks, then cleans up the project.
 */
async function generateLogs(page: Page): Promise<void> {
  // Create a temporary project -- this produces "server" category logs
  const projectName = `LogTest-${Date.now()}`;
  const createRes = await page.request.post("/api/projects", {
    data: { name: projectName, path: "/tmp" },
  });
  if (createRes.ok()) {
    const project = await createRes.json();
    const projectId = project.id;

    // Create a task -- this produces "tasks" category logs
    await page.request.post("/api/tasks", {
      data: {
        projectId,
        title: "Log test task",
        status: "todo",
        priority: "medium",
      },
    });

    // Delete the temp project to clean up
    await page.request.delete(`/api/projects/${projectId}`);
  }
}

/**
 * Ensure logs exist by checking the current total, and generating some if needed.
 */
async function ensureLogsExist(page: Page): Promise<void> {
  const response = await page.request.get("/api/logs?limit=1");
  const data = await response.json();
  if (data.total === 0) {
    await generateLogs(page);
  }
}

/**
 * Navigate to the logs page and wait for it to fully render.
 */
async function goToLogsPage(page: Page) {
  await page.goto("/logs", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: /system logs/i })
  ).toBeVisible({ timeout: 10000 });
}

test.describe("Logs Page", () => {
  test.beforeEach(async ({ page }) => {
    // Visit the app root first to dismiss onboarding if needed
    await page.goto("/", { waitUntil: "networkidle" });
    await dismissOnboarding(page);
    await page.waitForTimeout(500);
  });

  test("Logs page loads with heading and entries or empty state", async ({
    page,
  }) => {
    await goToLogsPage(page);

    // The entries count text should be present (e.g. "X entries")
    await expect(page.getByText(/\d+ entries/)).toBeVisible();

    // Either log entries are displayed, or we see the "No logs found" empty state
    const noLogs = page.getByText("No logs found");
    const logEntry = page.locator(".border.rounded").first();

    const hasNoLogs = await noLogs.isVisible().catch(() => false);
    const hasEntries = await logEntry.isVisible().catch(() => false);

    expect(hasNoLogs || hasEntries).toBe(true);
  });

  test("Level filter works", async ({ page }) => {
    // Ensure there are logs to filter
    await ensureLogsExist(page);
    await goToLogsPage(page);

    // The level filter is a shadcn Select (renders as role="combobox").
    // There are two comboboxes: level (first) and category (second).
    const selectTriggers = page.getByRole("combobox");
    const levelTrigger = selectTriggers.first();

    await expect(levelTrigger).toBeVisible();
    await expect(levelTrigger).toContainText("All Levels");

    // Open the level dropdown and select "Info"
    await levelTrigger.click();
    const infoOption = page.getByRole("option", { name: "Info" });
    await expect(infoOption).toBeVisible();
    await infoOption.click();

    // The trigger should now show "Info"
    await expect(levelTrigger).toContainText("Info");

    // Wait for the filtered query to resolve and the DOM to update
    await page.waitForLoadState("networkidle");

    // Check that either entries are present with "info" badge or the list is empty
    const noLogsVisible = await page
      .getByText("No logs found")
      .isVisible()
      .catch(() => false);

    if (!noLogsVisible) {
      // Wait for at least one log entry to appear
      const firstEntry = page.locator(".border.rounded").first();
      await expect(firstEntry).toBeVisible({ timeout: 5000 });

      // All visible entries should have "info" level badge
      const logEntries = page.locator(".border.rounded");
      const count = await logEntries.count();
      for (let i = 0; i < count; i++) {
        const entry = logEntries.nth(i);
        const levelBadge = entry.locator('[data-slot="badge"]').first();
        await expect(levelBadge).toHaveText("info");
      }
    }

    // Now switch to "Error" filter -- there may be zero error-level logs
    await levelTrigger.click();
    const errorOption = page.getByRole("option", { name: "Error" });
    await expect(errorOption).toBeVisible();
    await errorOption.click();

    await expect(levelTrigger).toContainText("Error");
    await page.waitForLoadState("networkidle");

    // Verify: either "No logs found" or all entries have "error" badge
    const noErrorLogs = await page
      .getByText("No logs found")
      .isVisible()
      .catch(() => false);

    if (!noErrorLogs) {
      const errorEntries = page.locator(".border.rounded");
      const errorCount = await errorEntries.count();
      for (let i = 0; i < errorCount; i++) {
        const entry = errorEntries.nth(i);
        const levelBadge = entry.locator('[data-slot="badge"]').first();
        await expect(levelBadge).toHaveText("error");
      }
    }

    // Reset to "All Levels" and verify it works
    await levelTrigger.click();
    const allOption = page.getByRole("option", { name: "All Levels" });
    await expect(allOption).toBeVisible();
    await allOption.click();

    await expect(levelTrigger).toContainText("All Levels");
  });

  test("Category filter works", async ({ page }) => {
    await ensureLogsExist(page);
    await goToLogsPage(page);

    // Category is the second combobox
    const selectTriggers = page.getByRole("combobox");
    const categoryTrigger = selectTriggers.nth(1);

    await expect(categoryTrigger).toBeVisible();
    await expect(categoryTrigger).toContainText("All Categories");

    // Open the category dropdown and select "server"
    await categoryTrigger.click();
    const serverOption = page.getByRole("option", { name: "server" });
    await expect(serverOption).toBeVisible();
    await serverOption.click();

    // The trigger should now show "server"
    await expect(categoryTrigger).toContainText("server");

    await page.waitForLoadState("networkidle");

    // Verify: either "No logs found" or all entries have "server" category badge
    const noServerLogs = await page
      .getByText("No logs found")
      .isVisible()
      .catch(() => false);

    if (!noServerLogs) {
      const firstEntry = page.locator(".border.rounded").first();
      await expect(firstEntry).toBeVisible({ timeout: 5000 });

      const logEntries = page.locator(".border.rounded");
      const count = await logEntries.count();
      for (let i = 0; i < count; i++) {
        const entry = logEntries.nth(i);
        const badges = entry.locator('[data-slot="badge"]');
        const categoryBadge = badges.nth(1);
        await expect(categoryBadge).toHaveText("server");
      }
    }

    // Reset to "All Categories"
    await categoryTrigger.click();
    const allOption = page.getByRole("option", { name: "All Categories" });
    await expect(allOption).toBeVisible();
    await allOption.click();

    await expect(categoryTrigger).toContainText("All Categories");
  });

  test("Log entries have expected structure (level, category, message, timestamp)", async ({
    page,
  }) => {
    await ensureLogsExist(page);
    await goToLogsPage(page);

    // Wait for data to load
    await page.waitForLoadState("networkidle");

    const logEntries = page.locator(".border.rounded");
    const count = await logEntries.count();

    if (count === 0) {
      // If no logs, verify empty state and pass
      await expect(page.getByText("No logs found")).toBeVisible();
      return;
    }

    // Check the first log entry has the expected structure
    const firstEntry = logEntries.first();
    await expect(firstEntry).toBeVisible();

    // Level badge: should be one of info, warn, error
    const badges = firstEntry.locator('[data-slot="badge"]');
    const levelBadge = badges.first();
    const levelText = await levelBadge.textContent();
    expect(["info", "warn", "error"]).toContain(levelText?.trim());

    // Category badge: should be one of the known categories
    const categoryBadge = badges.nth(1);
    const categoryText = await categoryBadge.textContent();
    const knownCategories = [
      "server",
      "git",
      "claude",
      "sync",
      "terminal",
      "mcp",
      "tasks",
      "files",
    ];
    expect(knownCategories).toContain(categoryText?.trim());

    // Message: the entry should contain some text content
    const entryText = await firstEntry.textContent();
    expect(entryText!.length).toBeGreaterThan(0);

    // Timestamp: formatDistanceToNow produces strings like "2 minutes ago", "about 1 hour ago"
    const timePattern = /ago|just now|less than/;
    expect(entryText).toMatch(timePattern);

    // Verify the date group header exists above the entries
    const groupHeaders = page.locator(
      ".text-xs.font-medium.uppercase.tracking-wider"
    );
    const headerCount = await groupHeaders.count();
    expect(headerCount).toBeGreaterThan(0);

    // The header should be "Today", "Yesterday", or a date
    const headerText = await groupHeaders.first().textContent();
    expect(headerText!.trim().length).toBeGreaterThan(0);
  });

  test("Clear logs removes all entries", async ({ page }) => {
    // Generate fresh logs since previous tests may have cleared them
    await generateLogs(page);
    await goToLogsPage(page);

    // Wait for data to load
    await page.waitForLoadState("networkidle");

    // Check if there are logs to clear
    const entriesText = await page.getByText(/\d+ entries/).textContent();
    const totalBefore = parseInt(entriesText?.match(/(\d+)/)?.[1] ?? "0", 10);

    if (totalBefore === 0) {
      // No logs to clear; the button should be disabled
      const clearBtn = page.getByRole("button", { name: /clear logs/i });
      await expect(clearBtn).toBeDisabled();
      return;
    }

    // Click the "Clear Logs" button
    const clearBtn = page.getByRole("button", { name: /clear logs/i });
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toBeEnabled();
    await clearBtn.click();

    // A confirmation dialog should appear
    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByText("Clear all logs?")).toBeVisible();

    // Click "Continue" to confirm
    const continueBtn = confirmDialog.getByRole("button", {
      name: /continue/i,
    });
    await expect(continueBtn).toBeVisible();
    await continueBtn.click();

    // After clearing, the empty state should appear
    await expect(page.getByText("No logs found")).toBeVisible({
      timeout: 5000,
    });

    // The entry count should be "0 entries"
    await expect(page.getByText("0 entries")).toBeVisible();

    // The Clear Logs button should now be disabled
    await expect(
      page.getByRole("button", { name: /clear logs/i })
    ).toBeDisabled();
  });
});
