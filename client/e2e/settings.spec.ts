import { test, expect, Page, ConsoleMessage } from "@playwright/test";

const BASE_URL = "http://localhost:5173";

/**
 * Dismiss the onboarding wizard if it appears.
 * Sequence: "Get Started" -> "Skip" -> "Start Using Vibe Kanban"
 */
async function dismissOnboarding(page: Page) {
  const getStartedBtn = page.getByRole("button", { name: /get started/i });
  if (await getStartedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await getStartedBtn.click();
    await page.waitForTimeout(500);

    const skipBtn = page.getByRole("button", { name: /skip/i });
    if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await skipBtn.click();
      await page.waitForTimeout(500);
    }

    const startBtn = page.getByRole("button", { name: /start using vibe kanban/i });
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Navigate to the Settings page and wait until it is ready.
 * Handles onboarding dismissal and waits for the tab list to render.
 */
async function navigateToSettings(page: Page) {
  // First visit the app root to dismiss onboarding (it may only appear at root)
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await dismissOnboarding(page);

  // Navigate to settings
  await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });

  // Dismiss onboarding again in case it re-triggers on the settings route
  await dismissOnboarding(page);

  // Wait for the settings page to be fully rendered
  await page.getByRole("tablist").waitFor({ state: "visible", timeout: 10000 });
}

test.describe("Settings page", () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];

    // Collect console errors throughout the test
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    page.on("pageerror", (err) => {
      consoleErrors.push(`[PAGE ERROR] ${err.message}`);
    });

    await navigateToSettings(page);
  });

  test("Settings page loads with heading and tab list", async ({ page }) => {
    // Verify the main heading renders
    const heading = page.getByRole("heading", { name: /settings/i });
    await expect(heading).toBeVisible();

    // Verify the tab list is present
    const tabList = page.getByRole("tablist");
    await expect(tabList).toBeVisible();

    // Verify all six tab triggers are visible
    const expectedTabs = ["Projects", "Claude AI", "GitHub", "General", "Notion", "Data"];
    for (const tabName of expectedTabs) {
      const tab = page.getByRole("tab", { name: tabName });
      await expect(tab).toBeVisible();
    }
  });

  test("Tab navigation works - clicking each tab changes content", async ({ page }) => {
    // "Projects" tab is the default; verify it is active
    const projectsTab = page.getByRole("tab", { name: "Projects" });
    await expect(projectsTab).toHaveAttribute("data-state", "active");

    // Verify the Projects tab panel has content (Scan Directories label)
    await expect(page.getByText("Scan Directories")).toBeVisible();

    // Click "Claude AI" tab and verify content changes
    await page.getByRole("tab", { name: "Claude AI" }).click();
    await expect(page.getByRole("tab", { name: "Claude AI" })).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect(page.getByText("Claude CLI")).toBeVisible();
    // Projects content should no longer be visible
    await expect(page.getByText("Scan Directories")).not.toBeVisible();

    // Click "GitHub" tab
    await page.getByRole("tab", { name: "GitHub" }).click();
    await expect(page.getByRole("tab", { name: "GitHub" })).toHaveAttribute("data-state", "active");
    await expect(page.getByText("GitHub Accounts")).toBeVisible();

    // Click "General" tab
    await page.getByRole("tab", { name: "General" }).click();
    await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect(page.getByText("Sound Notifications")).toBeVisible();

    // Click "Notion" tab
    await page.getByRole("tab", { name: "Notion" }).click();
    await expect(page.getByRole("tab", { name: "Notion" })).toHaveAttribute("data-state", "active");
    await expect(page.getByText("Notion Integration")).toBeVisible();

    // Click "Data" tab
    await page.getByRole("tab", { name: "Data" }).click();
    await expect(page.getByRole("tab", { name: "Data" })).toHaveAttribute("data-state", "active");
    await expect(page.getByText("Data Management")).toBeVisible();
  });

  test("General section has expected controls", async ({ page }) => {
    // Navigate to General tab
    await page.getByRole("tab", { name: "General" }).click();

    // Verify Sound Notifications toggle
    await expect(page.getByText("Sound Notifications")).toBeVisible();
    await expect(page.getByText("Play sound on AI completion")).toBeVisible();

    // Verify there is a switch for sound (Radix Switch renders role="switch")
    const switches = page.getByRole("switch");
    await expect(switches.first()).toBeVisible();

    // Verify Terminal Shell selector
    await expect(page.getByText("Terminal Shell")).toBeVisible();
    await expect(page.getByText("Shell used for terminal sessions")).toBeVisible();

    // Verify the shell select trigger is visible (shows current value like CMD, Bash, etc.)
    const shellSelect = page.locator('button[role="combobox"]');
    await expect(shellSelect).toBeVisible();
  });

  test("Claude AI section renders with CLI status and API key input", async ({ page }) => {
    // Navigate to Claude AI tab
    await page.getByRole("tab", { name: "Claude AI" }).click();

    // Verify Claude CLI label is visible
    await expect(page.getByText("Claude CLI")).toBeVisible();

    // Verify a status badge is shown (either "Available" or "Not Found")
    const availableBadge = page.getByText("Available");
    const notFoundBadge = page.getByText("Not Found");
    const cliStatusVisible =
      (await availableBadge.isVisible().catch(() => false)) ||
      (await notFoundBadge.isVisible().catch(() => false));
    expect(cliStatusVisible).toBe(true);

    // Verify API Key label is visible
    await expect(page.getByText("API Key")).toBeVisible();

    // Verify the API key password input is present
    const apiKeyInput = page.getByPlaceholder("sk-ant-...");
    await expect(apiKeyInput).toBeVisible();

    // Verify the Save button is present
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();

    // Verify MCP Server toggle is visible
    await expect(page.getByText("MCP Server")).toBeVisible();
    await expect(page.getByText("Expose data via Model Context Protocol")).toBeVisible();
  });

  test("Data section has export and import buttons", async ({ page }) => {
    // Navigate to Data tab
    await page.getByRole("tab", { name: "Data" }).click();

    // Verify the section heading
    await expect(page.getByText("Data Management")).toBeVisible();

    // Verify Export JSON button
    const exportBtn = page.getByRole("button", { name: /export json/i });
    await expect(exportBtn).toBeVisible();

    // Verify Import JSON button (it is rendered as a span inside a label)
    const importBtn = page.getByText("Import JSON");
    await expect(importBtn).toBeVisible();
  });

  test("No critical console errors throughout settings navigation", async ({ page }) => {
    // Navigate through all tabs to exercise rendering
    const tabNames = ["Projects", "Claude AI", "GitHub", "General", "Notion", "Data"];
    for (const tabName of tabNames) {
      await page.getByRole("tab", { name: tabName }).click();
      // Brief wait for content to render and any async fetches to settle
      await page.waitForTimeout(300);
    }

    // Filter out non-critical errors (e.g., favicon 404, React DevTools, network issues)
    const criticalErrors = consoleErrors.filter((err) => {
      const lower = err.toLowerCase();
      // Skip known benign errors
      if (lower.includes("favicon")) return false;
      if (lower.includes("devtools")) return false;
      if (lower.includes("react-devtools")) return false;
      if (lower.includes("download the react devtools")) return false;
      if (lower.includes("third-party cookie")) return false;
      // Skip 500 errors from API endpoints — these are expected when services
      // like Claude CLI, GitHub, or Notion are not configured in the test env
      if (lower.includes("failed to load resource")) return false;
      if (lower.includes("500")) return false;
      return true;
    });

    if (criticalErrors.length > 0) {
      console.log("Critical console errors found:", criticalErrors);
    }
    expect(criticalErrors).toHaveLength(0);
  });
});
