import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
describe("Settings routes", () => {
  test("GET /api/settings returns a settings object", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
  });

  test("PUT /api/settings updates a writable setting and persists it", async () => {
    // Update a writable key
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { "Content-Type": "application/json" },
      payload: { soundEnabled: true },
    });
    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json();
    expect(putBody.soundEnabled).toBe(true);

    // Verify it persists on subsequent GET
    const getRes = await app.inject({ method: "GET", url: "/api/settings" });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.soundEnabled).toBe(true);
  });

  test("PUT /api/settings ignores non-writable keys", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { "Content-Type": "application/json" },
      payload: { nonWritableKey: "should-be-ignored" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nonWritableKey).toBeUndefined();
  });

  test("PUT /api/settings redacts sensitive keys in response", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { "Content-Type": "application/json" },
      payload: { claudeApiKey: "sk-test-secret-key" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The key should be redacted in the response
    expect(body.claudeApiKey).toBe("••••••••");
  });

  test("GET /api/settings omits mcp_client_ and mcp_token_ prefixed keys", async () => {
    // Insert a raw mcp_client_ row directly
    const { getDb } = await import("../db");
    const db = getDb();
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcp_client_test-filter-key",
      JSON.stringify({ clientId: "test", clientSecret: "secret" }),
    );
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcp_token_test-filter-tok",
      JSON.stringify({ accessToken: "tok", expiresAt: new Date().toISOString() }),
    );

    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body["mcp_client_test-filter-key"]).toBeUndefined();
    expect(body["mcp_token_test-filter-tok"]).toBeUndefined();

    // Clean up
    db.query("DELETE FROM settings WHERE key = ?").run("mcp_client_test-filter-key");
    db.query("DELETE FROM settings WHERE key = ?").run("mcp_token_test-filter-tok");
  });

  test("GET /api/settings returns null for redacted key when value is falsy", async () => {
    // Set claudeApiKey to null/falsy
    const { getDb } = await import("../db");
    const db = getDb();
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "claudeApiKey",
      JSON.stringify(null),
    );

    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Falsy value → redacted as null
    expect(body.claudeApiKey).toBeNull();
  });

  test("GET /api/settings — row with invalid JSON falls back to raw string value", async () => {
    // Insert a row with non-JSON value to trigger the catch block in readSettings
    const { getDb } = await import("../db");
    const db = getDb();
    const badKey = "terminalShell";
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      badKey,
      "not-valid-json{{{",
    );

    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The catch block returns the raw string instead of parsed value
    expect(body[badKey]).toBe("not-valid-json{{{");

    // Restore
    db.query("DELETE FROM settings WHERE key = ?").run(badKey);
  });

  test("PUT /api/settings — updates multiple writable keys in one request", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { "Content-Type": "application/json" },
      payload: {
        mcpEnabled: true,
        mcpAuthRequired: false,
        terminalShell: "/bin/zsh",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mcpEnabled).toBe(true);
    expect(body.mcpAuthRequired).toBe(false);
    expect(body.terminalShell).toBe("/bin/zsh");

    // Restore defaults
    await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { "Content-Type": "application/json" },
      payload: { mcpEnabled: false, mcpAuthRequired: true },
    });
  });
});

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------
describe("Todos routes", () => {
  let todoId1: string;
  let todoId2: string;

  test("POST /api/todos creates a todo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/todos",
      headers: { "Content-Type": "application/json" },
      payload: { title: "Integration test todo 1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe("Integration test todo 1");
    expect(body.completed).toBe(false);
    expect(body.sortOrder).toBeGreaterThan(0);
    todoId1 = body.id;
  });

  test("POST /api/todos creates a second todo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/todos",
      headers: { "Content-Type": "application/json" },
      payload: { title: "Integration test todo 2" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe("Integration test todo 2");
    todoId2 = body.id;
  });

  test("GET /api/todos lists todos including created ones", async () => {
    const res = await app.inject({ method: "GET", url: "/api/todos" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);

    const ids = body.map((t: any) => t.id);
    expect(ids).toContain(todoId1);
    expect(ids).toContain(todoId2);
  });

  test("PATCH /api/todos/:id updates title", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/todos/${todoId1}`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Updated title" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("Updated title");
    expect(body.id).toBe(todoId1);
  });

  test("PATCH /api/todos/:id toggles completed", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/todos/${todoId1}`,
      headers: { "Content-Type": "application/json" },
      payload: { completed: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.completed).toBe(true);
  });

  test("PATCH /api/todos/:id returns 404 for non-existent todo", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/todos/non-existent-id",
      headers: { "Content-Type": "application/json" },
      payload: { title: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });

  test("PATCH /api/todos/reorder reorders todos", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/todos/reorder",
      headers: { "Content-Type": "application/json" },
      payload: {
        todos: [
          { id: todoId2, sortOrder: 1 },
          { id: todoId1, sortOrder: 2 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);

    // Verify the order changed
    const listRes = await app.inject({ method: "GET", url: "/api/todos" });
    const list = listRes.json();
    // todoId1 is completed so it sorts after uncompleted; among uncompleted todoId2 should come first
    const todo2 = list.find((t: any) => t.id === todoId2);
    const todo1 = list.find((t: any) => t.id === todoId1);
    expect(todo2.sortOrder).toBe(1);
    expect(todo1.sortOrder).toBe(2);
  });

  test("DELETE /api/todos/clear-completed clears completed todos", async () => {
    // todoId1 is completed from a previous test
    const res = await app.inject({
      method: "DELETE",
      url: "/api/todos/clear-completed",
    });
    expect(res.statusCode).toBe(204);

    // Verify it was removed
    const listRes = await app.inject({ method: "GET", url: "/api/todos" });
    const list = listRes.json();
    const ids = list.map((t: any) => t.id);
    expect(ids).not.toContain(todoId1);
    // todoId2 (not completed) should still exist
    expect(ids).toContain(todoId2);
  });

  test("DELETE /api/todos/:id deletes a todo", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/todos/${todoId2}`,
    });
    expect(res.statusCode).toBe(204);

    // Verify it was removed
    const listRes = await app.inject({ method: "GET", url: "/api/todos" });
    const list = listRes.json();
    const ids = list.map((t: any) => t.id);
    expect(ids).not.toContain(todoId2);
  });

  test("DELETE /api/todos/:id returns 404 for non-existent todo", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/todos/non-existent-id",
    });
    expect(res.statusCode).toBe(404);
  });

  test("PATCH /api/todos/:id — sets linkedTaskId to null when value is falsy", async () => {
    // Create a todo without a linkedTaskId
    const createRes = await app.inject({
      method: "POST",
      url: "/api/todos",
      headers: { "Content-Type": "application/json" },
      payload: { title: "linked task null test" },
    });
    const created = createRes.json();
    expect(created.id).toBeDefined();

    // Patch with an empty string linkedTaskId — the code does `value || null`,
    // so an empty string becomes null
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/todos/${created.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { linkedTaskId: "" },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json();
    expect(patched.linkedTaskId).toBeNull();

    // Clean up
    await app.inject({ method: "DELETE", url: `/api/todos/${created.id}` });
  });

  test("PATCH /api/todos/:id — returns unchanged todo when no allowed fields provided", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/todos",
      headers: { "Content-Type": "application/json" },
      payload: { title: "no-field patch test" },
    });
    const created = createRes.json();

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/todos/${created.id}`,
      headers: { "Content-Type": "application/json" },
      payload: { unknownField: "ignored" },
    });
    expect(patchRes.statusCode).toBe(200);
    // Should return the existing todo unchanged
    expect(patchRes.json().id).toBe(created.id);
    expect(patchRes.json().title).toBe("no-field patch test");

    // Clean up
    await app.inject({ method: "DELETE", url: `/api/todos/${created.id}` });
  });
});

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------
describe("Logs routes", () => {
  test("GET /api/logs returns structured log response", async () => {
    const res = await app.inject({ method: "GET", url: "/api/logs" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(typeof body.hasMore).toBe("boolean");
  });

  test("GET /api/logs?level=info filters by level", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/logs?level=info",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    // All returned items should have level=info
    for (const item of body.items) {
      expect(item.level).toBe("info");
    }
  });

  test("GET /api/logs?category=server filters by category", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/logs?category=server",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    for (const item of body.items) {
      expect(item.category).toBe("server");
    }
  });

  test("GET /api/logs supports limit and offset", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/logs?limit=2&offset=0",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeLessThanOrEqual(2);
  });

  test("DELETE /api/logs clears all logs", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/logs" });
    expect(res.statusCode).toBe(204);

    // Verify logs are cleared
    const getRes = await app.inject({ method: "GET", url: "/api/logs" });
    const body = getRes.json();
    expect(body.total).toBe(0);
    expect(body.items.length).toBe(0);
  });
});
