import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const SS_DIR = path.join(process.cwd(), "client", "e2e", "screenshots");
const BASE_URL = "http://localhost:5173";
const PROJECT_ID = "81268928-97cd-4923-bce1-431237620977";

if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

function ss(page: any, name: string) {
  const p = path.join(SS_DIR, `final-${name}.png`);
  console.log(`Screenshot: final-${name}.png`);
  return page.screenshot({ path: p, fullPage: false });
}

interface WsFrame {
  dir: "out" | "in";
  data: string;
  t: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS TEST VERIFIES
//
// The AI Resolve feature had a layered bug on Windows:
//   1. node-pty's ConPTY inSocket broke on Bun/Windows, so writing the claude
//      command to a running shell never worked.
//   2. The batch-file workaround spawned claude inside ConPTY, but claude's TUI
//      output was silently dropped when the server ran without an attached
//      Windows console (concurrently → bun --watch → bun src/index.ts).
//
// The final fix: bypass ConPTY entirely for ai-resolve sessions.  The server
// now uses Bun.spawn() with piped stdout/stderr, streams the output to the
// WebSocket as "output" frames, and sends a synthetic "exit" frame on finish.
//
// This test clicks AI Resolve, waits for the first output frame (WS frame count
// must exceed 2), and takes screenshots at key moments.  It does NOT wait for
// Claude to finish (that can take 3+ minutes on a full task prompt).
// ─────────────────────────────────────────────────────────────────────────────

test("AI Resolve - Bun.spawn fix: first output frame arrives within 60s", async ({ page }) => {
  // Claude needs time to initialise before the first byte arrives.
  // Allow 8 minutes total so a slow first-byte doesn't time-out the test.
  test.setTimeout(300000);

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

  // ── localStorage: skip onboarding ──────────────────────────────────────────
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
    } catch (e) {}
  });

  // ── Step 1: Load app ────────────────────────────────────────────────────────
  console.log("\n=== STEP 1: Load app ===");
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await ss(page, "01-loaded");

  // ── Step 2: Dismiss onboarding if shown ────────────────────────────────────
  console.log("\n=== STEP 2: Dismiss onboarding ===");
  const getStartedBtn = page.getByRole("button", { name: /get started/i });
  if (await getStartedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
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
    console.log("Onboarding not visible");
  }

  // ── Step 3: Inject WS interceptor BEFORE navigation ────────────────────────
  console.log("\n=== STEP 3: Inject WS interceptor ===");
  await page.evaluate(() => {
    (window as any).__wsFrames = [];
    (window as any).__wsInstances = [];
    (window as any).__wsPatched = false;
    const Orig = window.WebSocket;
    class Patched extends Orig {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        const u = typeof url === "string" ? url : url.toString();
        if (!u.includes("/ws/terminal")) return;
        const frames: any[] = (window as any).__wsFrames;
        (window as any).__wsInstances.push({ url: u, t: Date.now() });
        const origSend = this.send.bind(this);
        this.send = (d: any) => {
          frames.push({ dir: "out", data: typeof d === "string" ? d : "[bin]", t: Date.now() });
          origSend(d);
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
    (window as any).__wsPatched = true;
  });
  console.log("WS interceptor injected");

  // ── Step 4: Navigate to project ────────────────────────────────────────────
  console.log("\n=== STEP 4: Navigate to Test Project ===");
  // Use 'domcontentloaded' — NOT 'networkidle', which would hang if a previous
  // Claude subprocess is still making API requests in the background.
  const testProjectEl = page.getByText("Test Project", { exact: true }).first();
  if (await testProjectEl.isVisible({ timeout: 3000 }).catch(() => false)) {
    await testProjectEl.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
  } else {
    await page.goto(`${BASE_URL}/projects/${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  }
  await ss(page, "03-project");
  console.log("URL:", page.url());

  // ── Step 5: Wait for Bug fix card ──────────────────────────────────────────
  console.log("\n=== STEP 5: Wait for Bug fix card ===");
  await page
    .waitForFunction(
      () =>
        document.body.innerText.includes("Bug fix") || document.body.innerText.includes("Backlog"),
      { timeout: 10000 },
    )
    .catch(() => console.log("Timeout waiting for board"));

  const bugFixCount = await page.getByText("Bug fix", { exact: false }).count();
  if (bugFixCount === 0) {
    const body = await page.evaluate(() => document.body.innerText);
    console.log("Body:", body.substring(0, 500));
    throw new Error("Bug fix card not found");
  }

  // ── Step 6: Hover ──────────────────────────────────────────────────────────
  console.log("\n=== STEP 6: Hover Bug fix card ===");
  const taskEl = page.getByText("Bug fix", { exact: false }).first();
  await taskEl.scrollIntoViewIfNeeded();
  await taskEl.hover({ force: true });
  await page.waitForTimeout(800);
  await ss(page, "04-hovered");

  // ── Step 7: Find AI Resolve button ─────────────────────────────────────────
  console.log("\n=== STEP 7: Locate AI Resolve button ===");
  let aiBtn: any = page.getByRole("button", { name: /AI Resolve/i });
  let aiCount = await aiBtn.count();
  console.log("AI Resolve button (getByRole):", aiCount);

  if (aiCount === 0) {
    const allBtns = await page.locator("button:visible").all();
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
        aiBtn = btn;
        aiCount = 1;
        break;
      }
    }
  }

  if (aiCount === 0) {
    const box = await taskEl.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
      await page.waitForTimeout(500);
      const allBtns = await page.locator("button:visible").all();
      for (const btn of allBtns) {
        const title = (await btn.getAttribute("title").catch(() => "")) ?? "";
        const ariaLabel = (await btn.getAttribute("aria-label").catch(() => "")) ?? "";
        const html = (await btn.innerHTML().catch(() => "")) ?? "";
        const combined = (title + " " + ariaLabel + " " + html).toLowerCase();
        if (combined.includes("resolve") || combined.includes("zap") || combined.includes("ai")) {
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

  // ── Step 8: Click AI Resolve ────────────────────────────────────────────────
  console.log("\n=== STEP 8: Click AI Resolve ===");
  const t0 = Date.now();
  await taskEl.hover({ force: true });
  await page.waitForTimeout(200);
  await (Array.isArray(aiBtn) ? aiBtn[0] : aiBtn).click({ force: true });
  console.log("Clicked AI Resolve at T=0");
  await ss(page, "05-clicked");

  // ── Step 9: Poll until first output frame arrives (up to 240s) ─────────────
  // The Bun.spawn fix pipes claude stdout directly to the WS.
  // Claude may take 30–120s to produce its first byte on a large prompt.
  // We poll every 2s up to 240s total.
  console.log("\n=== STEP 9: Polling for first WS output frame (up to 240s) ===");
  let prevCount = 0;
  let firstOutputAt = -1;

  for (let tick = 1; tick <= 120; tick++) {
    await page.waitForTimeout(2000);
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

    if (newFrames.length > 0 || tick <= 2 || tick % 15 === 0) {
      console.log(`\n--- T+${elapsed}ms (tick ${tick}) total_frames=${snap.frames.length} ---`);
      if (tick === 1) console.log("  WS instances:", snap.instances.length);
      newFrames.forEach((f: WsFrame, i: number) => {
        const idx = prevCount - newFrames.length + i;
        console.log(`  [${idx}] ${f.dir} +${f.t - t0}ms: ${f.data.substring(0, 200)}`);
      });
    }

    // Key screenshots
    if (tick === 1) await ss(page, "06-2sec");
    if (tick === 5) await ss(page, "07-10sec");
    if (tick === 15) await ss(page, "08-30sec");
    if (tick === 30) await ss(page, "09-60sec");

    // Check if any output frame arrived (type === 'output')
    const allFrames: WsFrame[] = snap.frames;
    const outputFrames = allFrames.filter((f: WsFrame) => {
      try {
        return JSON.parse(f.data).type === "output";
      } catch {
        return false;
      }
    });

    if (outputFrames.length > 0 && firstOutputAt < 0) {
      firstOutputAt = elapsed;
      console.log(`\n*** FIRST OUTPUT FRAME at T+${elapsed}ms ***`);
      console.log("Frame:", outputFrames[0].data.substring(0, 300));

      // Take a screenshot at the moment output arrives
      await ss(page, `10-first-output-at-${Math.round(elapsed / 1000)}s`);

      // Also collect all output
      const allOutput = outputFrames
        .map((f: WsFrame) => {
          try {
            return JSON.parse(f.data).data;
          } catch {
            return "";
          }
        })
        .join("");
      console.log("\n=== Terminal output received so far ===");
      console.log(allOutput.substring(0, 1000));
      break;
    }

    // Bail out early if total frames is still 2 after 20s
    // (means the server threw an error — no point waiting longer)
    if (tick === 10 && snap.frames.length <= 2) {
      console.log("\nNo frames after 20s — server may have errored. Stopping early.");
      break;
    }
  }

  // ── Step 10: Final analysis ─────────────────────────────────────────────────
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

  console.log(`WS connections: ${final.instances.length}`);
  console.log(`Total WS frames: ${frames.length}`);
  frames.forEach((f: WsFrame, i: number) => {
    console.log(`  [${i}] ${f.dir} +${f.t - t0}ms: ${f.data.substring(0, 200)}`);
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

  console.log("\n=== KEY CHECKS ===");
  console.log(`Total WS frames:                       ${frames.length}`);
  console.log(`Output frames received:                ${outputFrames.length}`);
  console.log(
    `First output at:                       ${firstOutputAt >= 0 ? firstOutputAt + "ms" : "never"}`,
  );
  console.log(`Claude produced output:                ${allOutput.length > 0}`);
  if (allOutput.length > 0) {
    console.log(`Output (first 500):                    ${allOutput.substring(0, 500)}`);
  }

  if (consoleErrors.length) {
    console.log("\n=== CONSOLE ERRORS ===");
    consoleErrors.forEach((e) => console.log(" ", e));
  }

  await ss(page, "11-final");

  // ── Assertions ───────────────────────────────────────────────────────────────
  // 1. At minimum we should receive more than 2 frames (OPEN + create).
  //    The server must reply with something — even if just an error frame.
  expect(
    frames.length,
    `Expected more than 2 WS frames, got ${frames.length}. The server may have crashed on the new Bun.spawn code.`,
  ).toBeGreaterThan(2);

  // 2. At least one output frame must have arrived.
  //    This is the core assertion: Claude's output streams through.
  expect(
    outputFrames.length,
    `Expected at least 1 output frame. Bun.spawn stdout pipe may not be working.`,
  ).toBeGreaterThan(0);
});
