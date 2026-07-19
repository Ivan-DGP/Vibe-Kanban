import { test, expect, Page } from "@playwright/test";

const BASE_API = "http://127.0.0.1:3001/api";
let projectId = "";

test.beforeAll(async () => {
  const r = await fetch(`${BASE_API}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Specialist E2E", path: `/tmp/e2e-specialist-${Date.now()}` }),
  });
  projectId = (await r.json()).id;
});

test.afterAll(async () => {
  if (projectId) await fetch(`${BASE_API}/projects/${projectId}`, { method: "DELETE" });
});

async function dismissOnboarding(page: Page) {
  const b = page.getByRole("button", { name: /get started/i });
  if (await b.isVisible({ timeout: 2000 }).catch(() => false)) {
    await b.click();
    const skip = page.getByRole("button", { name: /skip/i });
    if (await skip.isVisible({ timeout: 2000 }).catch(() => false)) await skip.click();
    const start = page.getByRole("button", { name: /start using vibe kanban/i });
    if (await start.isVisible({ timeout: 2000 }).catch(() => false)) await start.click();
  }
}

// Stub the SSE stream so the panel is tested deterministically — no dependency on
// the Claude CLI or the embedding model. Frames match the server's wire format.
const SSE_BODY = [
  `data: ${JSON.stringify({
    type: "sources",
    sources: [
      {
        id: "m1",
        kind: "memory",
        label: "JWT rotation lesson",
        project: "Auth Gateway",
        snippet: "rotate signing keys without downtime",
      },
    ],
  })}`,
  "",
  `data: ${JSON.stringify({ type: "delta", text: "Yes — we solved JWT rotation " })}`,
  "",
  `data: ${JSON.stringify({ type: "delta", text: "in Auth Gateway." })}`,
  "",
  `data: ${JSON.stringify({ type: "done" })}`,
  "",
  "",
].join("\n");

test("specialist panel renders grounded sources + streamed answer", async ({ page }) => {
  await page.route("**/api/specialist/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: SSE_BODY,
    }),
  );

  await page.goto(`/project/${projectId}`, { waitUntil: "networkidle" });
  await dismissOnboarding(page);

  await page.getByRole("button", { name: /^Specialist$/ }).click();
  const panel = page.getByRole("dialog", { name: /Specialist/ });
  await expect(panel).toBeVisible();

  const box = panel.getByPlaceholder(/ask the specialist/i);
  await box.fill("Have we solved JWT rotation before?");
  await box.press("Enter");

  // The grounded sources render (label + project attribution inside the badge)...
  await expect(panel.getByText(/Grounded in 1 source/i)).toBeVisible({ timeout: 10000 });
  await expect(panel.getByText("JWT rotation lesson")).toBeVisible();
  await expect(panel.getByText(/· Auth Gateway/)).toBeVisible(); // project attribution in the badge
  // ...and the streamed answer.
  await expect(panel.getByText(/Yes — we solved JWT rotation in Auth Gateway\./)).toBeVisible();
});
