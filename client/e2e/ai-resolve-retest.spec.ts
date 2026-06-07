import { test } from "@playwright/test";
import path from "path";
import fs from "fs";

const SS_DIR = path.join(process.cwd(), "client", "e2e", "screenshots");
const BASE_URL = "http://localhost:5173";

if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

function ss(page: any, name: string) {
  const p = path.join(SS_DIR, `retest-${name}.png`);
  console.log(`Screenshot: retest-${name}.png`);
  return page.screenshot({ path: p, fullPage: false });
}

interface WsFrame {
  dir: "out" | "in";
  data: string;
  t: number;
}

test("AI Resolve retest - verify command appears in terminal", async ({ page }) => {
  // ── Error capture ────────────────────────────────────────────────────────
  const consoleErrors: string[] = [];
  page.on("console", (msg: any) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
      console.log("CONSOLE ERROR:", msg.text());
    }
  });
  page.on("pageerror", (err: any) => {
    consoleErrors.push(err.message);
    console.log("PAGE ERROR:", err.message);
  });

  // ── Step 1: Load app from root ───────────────────────────────────────────
  console.log("\n=== STEP 1: Load app ===");
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await ss(page, "01-loaded");
  console.log("URL:", page.url(), "| Title:", await page.title());

  // ── Step 2: Dismiss onboarding wizard ────────────────────────────────────
  console.log("\n=== STEP 2: Dismiss onboarding ===");
  const getStartedBtn = page.getByRole("button", { name: /get started/i });
  if (await getStartedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log("Onboarding visible - dismissing...");
    await getStartedBtn.click();
    await page.waitForTimeout(800);

    const skipBtn = page.getByRole("button", { name: /skip/i });
    if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipBtn.click();
      await page.waitForTimeout(800);
    }

    const startBtn = page.getByRole("button", { name: /start using vibe kanban/i });
    if (await startBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(1000);
    }
    console.log("Onboarding dismissed");
  } else {
    console.log("Onboarding not visible (already dismissed)");
  }
  await ss(page, "02-dashboard");

  // ── Step 3: Inject WS interceptor BEFORE navigation (SPA = no reload) ────
  console.log("\n=== STEP 3: Inject WS interceptor ===");
  await page.evaluate(() => {
    (window as any).__wsFrames = (window as any).__wsFrames || [];
    (window as any).__wsInstances = (window as any).__wsInstances || [];
    if ((window as any).__wsPatched) return;
    (window as any).__wsPatched = true;
    const Orig = window.WebSocket;
    class Patched extends Orig {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        const u = typeof url === "string" ? url : url.toString();
        if (!u.includes("/ws/terminal")) return;
        const frames: any[] = (window as any).__wsFrames;
        (window as any).__wsInstances.push({ url: u, t: Date.now() });
        const orig = this.send.bind(this);
        this.send = (d: any) => {
          frames.push({ dir: "out", data: typeof d === "string" ? d : "[bin]", t: Date.now() });
          orig(d);
        };
        this.addEventListener("open", () =>
          frames.push({ dir: "in", data: "[OPEN]", t: Date.now() }),
        );
        this.addEventListener("close", (e: CloseEvent) =>
          frames.push({ dir: "in", data: `[CLOSE ${e.code}]`, t: Date.now() }),
        );
        this.addEventListener("error", () =>
          frames.push({ dir: "in", data: "[ERROR]", t: Date.now() }),
        );
        this.addEventListener("message", (e: MessageEvent) =>
          frames.push({ dir: "in", data: e.data, t: Date.now() }),
        );
      }
    }
    window.WebSocket = Patched as any;
  });
  console.log("WS interceptor injected");

  // ── Step 4: Navigate to Test Project ─────────────────────────────────────
  console.log("\n=== STEP 4: Navigate to Test Project ===");
  const testProjectEl = page.getByText("Test Project", { exact: true }).first();
  if (await testProjectEl.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Clicking "Test Project" in sidebar/dashboard');
    await testProjectEl.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
  } else {
    console.log("Not found via getByText, navigating directly...");
    await page.goto(`${BASE_URL}/projects/81268928-97cd-4923-bce1-431237620977`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);
  }
  await ss(page, "03-project");
  console.log("URL after nav:", page.url());

  // ── Step 5: Wait for task cards ───────────────────────────────────────────
  console.log("\n=== STEP 5: Wait for task cards ===");
  await page
    .waitForFunction(
      () => {
        const body = document.body.innerText;
        return (
          body.includes("Bug fix") || body.includes("Test kanban task") || body.includes("Inbox")
        );
      },
      { timeout: 10000 },
    )
    .catch(() => console.log("Timeout waiting for task cards"));

  const bugFixCount = await page.getByText("Bug fix", { exact: false }).count();
  console.log('"Bug fix" occurrences:', bugFixCount);
  if (bugFixCount === 0) {
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log("Body text:", bodyText.substring(0, 800));
    await ss(page, "FAIL-no-bugfix");
    throw new Error("Bug fix task not found on board");
  }

  // ── Step 6: Hover the Bug fix card ───────────────────────────────────────
  console.log("\n=== STEP 6: Hover Bug fix card ===");
  const taskEl = page.getByText("Bug fix", { exact: false }).first();
  await taskEl.scrollIntoViewIfNeeded();
  await taskEl.hover({ force: true });
  await page.waitForTimeout(800);
  await ss(page, "04-hovered");

  // ── Step 7: Locate AI Resolve button ─────────────────────────────────────
  console.log("\n=== STEP 7: Locate AI Resolve button ===");

  // Primary: role=button with AI Resolve name
  let aiBtn = page.getByRole("button", { name: /AI Resolve/i });
  let aiCount = await aiBtn.count();
  console.log("AI Resolve button (getByRole):", aiCount);

  if (aiCount === 0) {
    // Scan all visible buttons
    const allBtns = await page.locator("button:visible").all();
    console.log(`Scanning ${allBtns.length} visible buttons...`);
    for (const btn of allBtns) {
      const title = (await btn.getAttribute("title").catch(() => "")) ?? "";
      const ariaLabel = (await btn.getAttribute("aria-label").catch(() => "")) ?? "";
      const html = (await btn.innerHTML().catch(() => "")) ?? "";
      const combined = (title + " " + ariaLabel + " " + html).toLowerCase();
      if (title || ariaLabel) console.log(`  btn title="${title}" aria="${ariaLabel}"`);
      if (
        combined.includes("resolve") ||
        combined.includes("zap") ||
        combined.includes("ai resolve")
      ) {
        console.log(`  -> Using this button: title="${title}" aria="${ariaLabel}"`);
        aiBtn = btn;
        aiCount = 1;
        break;
      }
    }
  }

  if (aiCount === 0) {
    // Try hovering right edge
    const box = await taskEl.boundingBox();
    if (box) {
      console.log("Trying right-edge hover...");
      await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
      await page.waitForTimeout(500);
      await ss(page, "04b-right-edge");

      const allBtns = await page.locator("button:visible").all();
      for (const btn of allBtns) {
        const title = (await btn.getAttribute("title").catch(() => "")) ?? "";
        const ariaLabel = (await btn.getAttribute("aria-label").catch(() => "")) ?? "";
        const html = (await btn.innerHTML().catch(() => "")) ?? "";
        const combined = (title + " " + ariaLabel + " " + html).toLowerCase();
        console.log(`  btn title="${title}" aria="${ariaLabel}" html="${html.substring(0, 60)}"`);
        if (combined.includes("resolve") || combined.includes("zap") || combined.includes("ai")) {
          console.log(`  -> Selected`);
          aiBtn = btn;
          aiCount = 1;
          break;
        }
      }
    }
  }

  if (aiCount === 0) {
    await ss(page, "FAIL-no-button");
    throw new Error("AI Resolve button not found");
  }

  // ── Step 8: Click AI Resolve ──────────────────────────────────────────────
  console.log("\n=== STEP 8: Click AI Resolve ===");
  const t0 = Date.now();
  await taskEl.hover({ force: true });
  await page.waitForTimeout(200);
  await (Array.isArray(aiBtn) ? aiBtn[0] : aiBtn).click({ force: true });
  console.log("Clicked AI Resolve at T=0");
  await ss(page, "05-clicked");

  // ── Step 9: Poll WS frames for 10 seconds ────────────────────────────────
  console.log("\n=== STEP 9: Polling WS frames for 10s ===");
  let prevCount = 0;
  for (let tick = 1; tick <= 20; tick++) {
    await page.waitForTimeout(500);
    const elapsed = Date.now() - t0;

    const snap = JSON.parse(
      await page.evaluate(() =>
        JSON.stringify({
          frames: (window as any).__wsFrames || [],
          instances: (window as any).__wsInstances || [],
        }),
      ),
    );

    const newFrames: WsFrame[] = snap.frames.slice(prevCount);
    prevCount = snap.frames.length;

    if (newFrames.length > 0 || tick <= 3 || tick === 10 || tick === 20) {
      console.log(`\n--- T+${elapsed}ms (tick ${tick}) ---`);
      if (tick === 1)
        console.log(
          "  WS instances:",
          snap.instances.length,
          snap.instances.map((i: any) => `+${i.t - t0}ms`),
        );
      if (newFrames.length === 0) {
        console.log("  (no new frames)");
      } else {
        newFrames.forEach((f: WsFrame, i: number) => {
          const idx = prevCount - newFrames.length + i;
          console.log(`  [${idx}] ${f.dir} +${f.t - t0}ms: ${f.data.substring(0, 300)}`);
        });
      }
    }

    // Take screenshots at key intervals
    if (tick === 2) await ss(page, "06-1sec");
    if (tick === 6) await ss(page, "07-3sec");
    if (tick === 14) await ss(page, "08-7sec");
    if (tick === 20) await ss(page, "09-10sec");
  }

  // ── Step 10: Final analysis ───────────────────────────────────────────────
  console.log("\n=== STEP 10: Final analysis ===");
  const final = JSON.parse(
    await page.evaluate(() =>
      JSON.stringify({
        frames: (window as any).__wsFrames || [],
        instances: (window as any).__wsInstances || [],
      }),
    ),
  );
  const frames: WsFrame[] = final.frames;
  const instances: any[] = final.instances;

  console.log(`WS connections: ${instances.length}`);
  instances.forEach((inst: any, i: number) => console.log(`  WS[${i}] +${inst.t - t0}ms`));
  console.log(`Total WS frames: ${frames.length}`);
  frames.forEach((f: WsFrame, i: number) => {
    console.log(`  [${i}] ${f.dir.padEnd(3)} +${f.t - t0}ms: ${f.data.substring(0, 300)}`);
  });

  const outputFrames = frames.filter((f: WsFrame) => {
    try {
      return JSON.parse(f.data).type === "output";
    } catch {
      return false;
    }
  });
  const allOutput = outputFrames
    .map((f: WsFrame) => {
      try {
        return JSON.parse(f.data).data;
      } catch {
        return "";
      }
    })
    .join("");

  console.log("\n=== TERMINAL OUTPUT (from WS output frames) ===");
  console.log(allOutput.substring(0, 1500) || "(no output frames)");

  // Also check DOM
  const xtermRows = await page
    .locator(".xterm-rows")
    .first()
    .innerText()
    .catch(() => null);
  const xtermA11y = await page
    .locator(".xterm-accessibility-tree")
    .first()
    .innerText()
    .catch(() => null);
  console.log("\n=== xterm-rows text ===");
  console.log(xtermRows ? xtermRows.substring(0, 1000) : "(null)");
  console.log("\n=== xterm accessibility tree ===");
  console.log(xtermA11y ? xtermA11y.substring(0, 1000) : "(null)");

  const allText = [allOutput, xtermRows, xtermA11y].filter(Boolean).join("\n");
  console.log("\n=== KEY CHECKS ===");
  console.log(`Contains "claude":                     ${allText.toLowerCase().includes("claude")}`);
  console.log(
    `Contains "vk-resolve":                 ${allText.toLowerCase().includes("vk-resolve")}`,
  );
  console.log(
    `Contains "--dangerously-skip-permissions": ${allText.toLowerCase().includes("dangerously")}`,
  );

  if (consoleErrors.length) {
    console.log("\n=== CONSOLE ERRORS ===");
    consoleErrors.forEach((e) => console.log(" ", e));
  } else {
    console.log("\nNo console errors.");
  }

  await ss(page, "10-final");
  console.log("\nDone. Final screenshot: retest-10-final.png");
});
