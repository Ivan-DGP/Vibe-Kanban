import { describe, test, expect, beforeAll, afterAll } from "bun:test";

// Disable embeddings so building the app + any grounding loads no model. Only the
// request-guard (400) path is exercised here — the streaming path hijacks the
// socket and spawns the CLI, so it isn't asserted via app.inject (same as /claude/chat).
process.env.VK_DISABLE_EMBEDDINGS = "1";

const { buildApp } = await import("../app");

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const post = (payload: unknown) =>
  app.inject({
    method: "POST",
    url: "/api/specialist/chat",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify(payload),
  });

describe("POST /api/specialist/chat — request guard", () => {
  test("400 when message is missing", async () => {
    const res = await post({});
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("message is required");
  });

  test("400 when message is blank", async () => {
    const res = await post({ message: "   " });
    expect(res.statusCode).toBe(400);
  });
});
