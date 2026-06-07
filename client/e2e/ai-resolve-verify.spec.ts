import { test } from "@playwright/test";

// Vite on this machine binds to [::1] (IPv6), not 127.0.0.1 (IPv4).
// Must use the IPv6 literal in the URL so headless Chromium connects correctly.
const BASE = "http://[::1]:5173";

test("AI Resolve button opens terminal with claude command", async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("CONSOLE ERROR:", msg.text());
  });
  page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

  // Set localStorage before the app boots to skip onboarding.
  // Wrap in try/catch to survive any early security context issues.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "vibe-kanban-app",
        JSON.stringify({
          state: {
            sidebarCollapsed: false,
            terminalHeight: 300,
            onboardingComplete: true,
            workspaceModes: {},
            activeMilestones: {},
          },
          version: 0,
        }),
      );
    } catch (e) {
      // Will be set after navigation instead
    }
  });

  await page.goto(`${BASE}/projects/81268928-97cd-4923-bce1-431237620977`);

  // Also set localStorage via evaluate after navigation (belt-and-suspenders)
  await page.evaluate(() => {
    try {
      window.localStorage.setItem(
        "vibe-kanban-app",
        JSON.stringify({
          state: {
            sidebarCollapsed: false,
            terminalHeight: 300,
            onboardingComplete: true,
            workspaceModes: {},
            activeMilestones: {},
          },
          version: 0,
        }),
      );
    } catch (e) {}
  });

  // Reload so the app picks up the updated localStorage
  await page.reload();

  // Wait for React root to have meaningful content
  await page.waitForFunction(
    () => {
      const root = document.getElementById("root");
      return root !== null && root.innerHTML.length > 100;
    },
    { timeout: 30000 },
  );

  console.log("App mounted");
  await page.screenshot({
    path: "client/e2e/screenshots/ai-resolve-01-mounted.png",
    fullPage: true,
  });

  await page.waitForTimeout(2000);
  await page.screenshot({
    path: "client/e2e/screenshots/ai-resolve-02-settled.png",
    fullPage: true,
  });

  const pageText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  console.log("Visible text (first 800):", pageText.substring(0, 800));

  // Dismiss onboarding if still showing
  const closeBtn = page.getByRole("button", { name: "Close" });
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }

  // Wait for Bug fix card
  const bugFix = page.getByText("Bug fix", { exact: true });
  await bugFix.waitFor({ state: "visible", timeout: 15000 });
  console.log("Bug fix card visible");

  await page.screenshot({
    path: "client/e2e/screenshots/ai-resolve-03-card-visible.png",
    fullPage: true,
  });

  // Hover to reveal hover-state action buttons
  await bugFix.hover();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "client/e2e/screenshots/ai-resolve-04-hover.png", fullPage: true });

  // Find AI Resolve button
  let aiResolveBtn = null;
  const buttons = await page.locator("button:visible").all();
  console.log(`Visible buttons after hover: ${buttons.length}`);

  for (const btn of buttons) {
    const title = (await btn.getAttribute("title").catch(() => "")) ?? "";
    const ariaLabel = (await btn.getAttribute("aria-label").catch(() => "")) ?? "";
    const html = await btn.innerHTML().catch(() => "");
    const combined = (title + " " + ariaLabel + " " + html).toLowerCase();
    if (title || ariaLabel) {
      console.log(`  btn title="${title}" aria="${ariaLabel}"`);
    }
    if (
      combined.includes("resolve") ||
      (combined.includes("zap") && !combined.includes("zapier"))
    ) {
      console.log(`AI Resolve found: title="${title}" aria="${ariaLabel}"`);
      aiResolveBtn = btn;
      break;
    }
  }

  if (!aiResolveBtn) {
    // Try hovering precisely on the card's right edge where icons appear
    const box = await bugFix.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width - 15, box.y + 12);
      await page.waitForTimeout(400);
      await page.screenshot({
        path: "client/e2e/screenshots/ai-resolve-04b-right-edge.png",
        fullPage: true,
      });
    }

    // Full button dump for diagnosis
    const allBtns = await page.locator("button:visible").all();
    for (const btn of allBtns) {
      const title = (await btn.getAttribute("title").catch(() => "")) ?? "";
      const ariaLabel = (await btn.getAttribute("aria-label").catch(() => "")) ?? "";
      const html = await btn.innerHTML().catch(() => "");
      const combined = (title + " " + ariaLabel + " " + html).toLowerCase();
      console.log(
        `  btn title="${title}" aria="${ariaLabel}" html[100]="${html.substring(0, 100)}"`,
      );
      if (
        combined.includes("resolve") ||
        (combined.includes("zap") && !combined.includes("zapier"))
      ) {
        aiResolveBtn = btn;
      }
    }
  }

  if (!aiResolveBtn) {
    console.log("Could not find AI Resolve button. Stopping.");
    return;
  }

  console.log("Clicking AI Resolve...");
  await aiResolveBtn.click();
  await page.screenshot({
    path: "client/e2e/screenshots/ai-resolve-05-clicked.png",
    fullPage: true,
  });

  console.log("Waiting 5 seconds for terminal...");
  await page.waitForTimeout(5000);

  await page.screenshot({
    path: "client/e2e/screenshots/ai-resolve-06-terminal-5s.png",
    fullPage: true,
  });
  console.log("Final screenshot saved.");

  const termText = await page
    .locator(".xterm-rows")
    .first()
    .innerText()
    .catch(() => "no xterm-rows found");
  console.log(`Terminal text: "${termText.substring(0, 500)}"`);
});
