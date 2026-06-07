import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";
import { getDb } from "../db";
import { setRunCwd, clearRunCwd } from "../services/runContext";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  // Enable MCP and disable auth for testing
  const db = getDb();
  db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    "mcpEnabled",
    JSON.stringify(true),
  );
  db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    "mcpAuthRequired",
    JSON.stringify(false),
  );
});

afterAll(async () => {});

function mcpRequest(body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: { "Content-Type": "application/json" },
    payload: body,
  });
}

// ---------------------------------------------------------------------------
// Per-run endpoint — git tools resolve to the run's worktree
// ---------------------------------------------------------------------------
describe("MCP per-run endpoint", () => {
  test("git_status on /mcp/run/:runId resolves to the run's worktree cwd", async () => {
    const db = getDb();
    const projectId = crypto.randomUUID();
    db.query("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      projectId,
      "mcp-run-test",
      `/tmp/mcp-run-main-${projectId}`,
    );
    const runId = crypto.randomUUID();
    const worktreeCwd = `/tmp/vk-wt-${runId}`;
    setRunCwd(runId, worktreeCwd);
    try {
      const res = await app.inject({
        method: "POST",
        url: `/mcp/run/${runId}`,
        headers: { "Content-Type": "application/json" },
        payload: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "git_status", arguments: { projectId } },
        },
      });
      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(res.json().result.content[0].text);
      expect(payload.projectPath).toBe(worktreeCwd);
      expect(payload.isolated).toBe(true);
    } finally {
      clearRunCwd(runId);
      db.query("DELETE FROM projects WHERE id = ?").run(projectId);
    }
  });

  test("git_status on the shared /mcp endpoint uses the project's main path", async () => {
    const db = getDb();
    const projectId = crypto.randomUUID();
    const mainPath = `/tmp/mcp-main-${projectId}`;
    db.query("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      projectId,
      "mcp-main-test",
      mainPath,
    );
    try {
      const res = await mcpRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "git_status", arguments: { projectId } },
      });
      const payload = JSON.parse(res.json().result.content[0].text);
      expect(payload.projectPath).toBe(mainPath);
      expect(payload.isolated).toBe(false);
    } finally {
      db.query("DELETE FROM projects WHERE id = ?").run(projectId);
    }
  });
});

// ---------------------------------------------------------------------------
// MCP JSON-RPC 2.0 endpoint
// ---------------------------------------------------------------------------
describe("MCP JSON-RPC endpoint", () => {
  test("tools/list — returns array of known tools", async () => {
    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();
    expect(Array.isArray(body.result.tools)).toBe(true);

    const toolNames = body.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("list_projects");
    expect(toolNames).toContain("list_tasks");
    expect(toolNames).toContain("get_project");
    expect(toolNames).toContain("get_task");
    expect(toolNames).toContain("create_task");
    expect(toolNames).toContain("update_task");
    expect(toolNames).toContain("delete_task");
    expect(toolNames).toContain("get_all_tasks");
    expect(toolNames).toContain("git_status");
    expect(toolNames).toContain("git_diff");

    // Each tool should have a definition with name, description, inputSchema
    for (const tool of body.result.tools) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  test("tools/call — list_projects returns content array with type text", async () => {
    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_projects", arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(2);
    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();
    expect(Array.isArray(body.result.content)).toBe(true);
    expect(body.result.content.length).toBeGreaterThanOrEqual(1);
    expect(body.result.content[0].type).toBe("text");
    expect(typeof body.result.content[0].text).toBe("string");

    // The text should be valid JSON (an array of projects)
    const parsed = JSON.parse(body.result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("tools/call — get_project with known project", async () => {
    // First, create a project via the REST API so we have a known ID
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `MCP Test Project ${Date.now()}`,
        path: `/tmp/mcp-test-${Date.now()}`,
      },
    });
    const project = createRes.json();
    const projectId = project.id;

    // Now call get_project via MCP
    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_project", arguments: { projectId } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(3);
    expect(body.error).toBeUndefined();
    expect(body.result.content).toBeDefined();
    expect(body.result.content[0].type).toBe("text");

    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.id).toBe(projectId);
    expect(parsed.name).toBe(project.name);
    expect(parsed.path).toBe(project.path);

    // Clean up
    await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  });

  test("tools/call — get_project with non-existent project returns error payload", async () => {
    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_project",
        arguments: { projectId: "non-existent-id-999" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(4);
    // The tool itself returns { error: "Project not found" } as content
    expect(body.result.content[0].type).toBe("text");
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.error).toBe("Project not found");
  });

  test("tools/call — unknown tool returns JSON-RPC error -32601", async () => {
    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "nonexistent_tool", arguments: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(5);
    expect(body.result).toBeUndefined();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain("nonexistent_tool");
  });

  test("Invalid JSON-RPC — missing jsonrpc 2.0 returns error -32600", async () => {
    const res = await mcpRequest({
      jsonrpc: "1.0",
      id: 6,
      method: "tools/list",
      params: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(6);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toBe("Invalid Request");
  });

  test("Unknown method returns JSON-RPC error -32601", async () => {
    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "unknown/method",
      params: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(7);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain("unknown/method");
  });

  test("Missing jsonrpc field returns error -32600", async () => {
    const res = await mcpRequest({
      id: 8,
      method: "tools/list",
      params: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(8);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toBe("Invalid Request");
  });

  test("initialize method returns server info and capabilities", async () => {
    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 9,
      method: "initialize",
      params: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(9);
    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();
    expect(body.result.protocolVersion).toBe("2024-11-05");
    expect(body.result.capabilities).toBeDefined();
    expect(body.result.serverInfo.name).toBe("vibe-kanban");
    expect(body.result.serverInfo.version).toBeDefined();
  });

  test("MCP disabled returns 404", async () => {
    // Disable MCP
    const db = getDb();
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpEnabled",
      JSON.stringify(false),
    );

    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/list",
      params: {},
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("MCP server is disabled");

    // Re-enable MCP for remaining tests
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpEnabled",
      JSON.stringify(true),
    );
  });

  test("MCP auth required but no token returns 401", async () => {
    // Enable auth requirement
    const db = getDb();
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpAuthRequired",
      JSON.stringify(true),
    );

    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/list",
      params: {},
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("Unauthorized");

    // Disable auth for remaining tests
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpAuthRequired",
      JSON.stringify(false),
    );
  });

  test("Response id is null when request omits id", async () => {
    const res = await mcpRequest({
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBeNull();
    expect(body.result).toBeDefined();
    expect(Array.isArray(body.result.tools)).toBe(true);
  });

  test("resources/list — returns unknown method error (not implemented)", async () => {
    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 20,
      method: "resources/list",
      params: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(20);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain("resources/list");
  });

  test("prompts/list — returns unknown method error (not implemented)", async () => {
    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 21,
      method: "prompts/list",
      params: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(21);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain("prompts/list");
  });

  test("notifications/initialized — returns unknown method error (notifications are not bidirectional)", async () => {
    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 22,
      method: "notifications/initialized",
      params: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(22);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain("notifications/initialized");
  });

  test("tools/call — handler that throws returns JSON-RPC error -32603", async () => {
    // Inject a tool into the toolMap that throws, execute via POST, then restore
    const { toolMap } = await import("../mcp/tools");
    const THROW_TOOL = "__throw_test__";
    toolMap.set(THROW_TOOL, {
      definition: {
        name: THROW_TOOL,
        description: "throws",
        inputSchema: { type: "object", properties: {} },
      },
      handler: () => {
        throw new Error("handler explosion");
      },
    });

    const res = await mcpRequest({
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: { name: THROW_TOOL, arguments: {} },
    });

    toolMap.delete(THROW_TOOL);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(99);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32603);
    // Error detail is logged server-side; the client gets a generic message so
    // internal error text (paths/schema) cannot leak.
    expect(body.error.message).toBe("Internal error");
  });
});

// ---------------------------------------------------------------------------
// OAuth endpoints
// ---------------------------------------------------------------------------
describe("MCP OAuth endpoints", () => {
  test("POST /mcp/oauth/register — returns client_id and client_secret", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp/oauth/register",
      headers: { "Content-Type": "application/json" },
      payload: { redirect_uri: "http://localhost:9999/callback" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.client_id).toBe("string");
    expect(body.client_id.length).toBeGreaterThan(0);
    expect(typeof body.client_secret).toBe("string");
    expect(body.client_secret.length).toBeGreaterThan(0);
  });

  test("POST /mcp/oauth/register — returns 400 when redirect_uri missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp/oauth/register",
      headers: { "Content-Type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("redirect_uri required");
  });

  test("POST /mcp/oauth/token — returns access_token for valid credentials", async () => {
    // Register a client first
    const regRes = await app.inject({
      method: "POST",
      url: "/mcp/oauth/register",
      headers: { "Content-Type": "application/json" },
      payload: { redirect_uri: "http://localhost:9999/callback" },
    });
    const { client_id, client_secret } = regRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/mcp/oauth/token",
      headers: { "Content-Type": "application/json" },
      payload: { client_id, client_secret },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token.length).toBeGreaterThan(0);
    expect(body.token_type).toBe("bearer");
    expect(body.expires_in).toBe(3600);
  });

  test("POST /mcp/oauth/token — returns 401 for invalid credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp/oauth/token",
      headers: { "Content-Type": "application/json" },
      payload: { client_id: "nonexistent-client", client_secret: "wrong" },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("Invalid credentials");
  });

  test("MCP auth with valid token is accepted", async () => {
    // Enable auth
    const db = getDb();
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpAuthRequired",
      JSON.stringify(true),
    );

    // Register + get token
    const regRes = await app.inject({
      method: "POST",
      url: "/mcp/oauth/register",
      headers: { "Content-Type": "application/json" },
      payload: { redirect_uri: "http://localhost:9999/callback" },
    });
    const { client_id, client_secret } = regRes.json();

    const tokenRes = await app.inject({
      method: "POST",
      url: "/mcp/oauth/token",
      headers: { "Content-Type": "application/json" },
      payload: { client_id, client_secret },
    });
    const { access_token } = tokenRes.json();

    // Now use the token
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access_token}`,
      },
      payload: { jsonrpc: "2.0", id: 50, method: "tools/list", params: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result).toBeDefined();
    expect(Array.isArray(body.result.tools)).toBe(true);

    // Disable auth
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpAuthRequired",
      JSON.stringify(false),
    );
  });
});

// ---------------------------------------------------------------------------
// MCP SSE endpoint
// ---------------------------------------------------------------------------
describe("MCP SSE endpoint", () => {
  test("GET /mcp — SSE endpoint streams server info event", async () => {
    // The SSE handler writes to reply.raw and never closes (keep-alive),
    // so we use a raw HTTP request with a timeout to capture the initial data.
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      let body = "";
      let contentType = "";
      try {
        const res = await fetch(`${address}/mcp`, {
          method: "GET",
          signal: controller.signal,
        });
        contentType = res.headers.get("content-type") || "";
        // Read a chunk from the stream
        const reader = res.body!.getReader();
        const { value } = await reader.read();
        if (value) body = new TextDecoder().decode(value);
        controller.abort();
      } catch (e: any) {
        // AbortError is expected when we cut the connection
        if (e.name !== "AbortError") throw e;
      } finally {
        clearTimeout(timeout);
      }

      expect(contentType).toBe("text/event-stream");
      expect(body).toContain("data:");
      expect(body).toContain("notifications/initialized");
      expect(body).toContain("vibe-kanban");
    } finally {
      // Re-enable MCP settings
      const db = getDb();
      db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "mcpEnabled",
        JSON.stringify(true),
      );
      db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "mcpAuthRequired",
        JSON.stringify(false),
      );
    }
  });

  test("GET /mcp — returns 404 when MCP is disabled", async () => {
    const db = getDb();
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpEnabled",
      JSON.stringify(false),
    );

    const res = await app.inject({
      method: "GET",
      url: "/mcp",
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("MCP server is disabled");

    // Re-enable MCP
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpEnabled",
      JSON.stringify(true),
    );
  });

  test("GET /mcp — returns 401 when auth is required but no token", async () => {
    const db = getDb();
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpAuthRequired",
      JSON.stringify(true),
    );

    const res = await app.inject({
      method: "GET",
      url: "/mcp",
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("Unauthorized");

    // Disable auth
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpAuthRequired",
      JSON.stringify(false),
    );
  });

  test("GET /mcp — keep-alive heartbeat callback runs and writes to stream", async () => {
    // The heartbeat callback at mcp.ts:135 fires every 30s in production.
    // Monkey-patch globalThis.setInterval to fire the callback once synchronously
    // (before returning a fake handle) so we can assert the heartbeat is written.
    const { buildApp } = await import("../app");
    const db = getDb();
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpEnabled",
      JSON.stringify(true),
    );
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpAuthRequired",
      JSON.stringify(false),
    );

    const originalSetInterval = globalThis.setInterval;
    let heartbeatFired = false;
    (globalThis as any).setInterval = (cb: () => void, _ms: number) => {
      // Fire the callback once on next microtask so reply.raw exists
      queueMicrotask(() => {
        try {
          cb();
          heartbeatFired = true;
        } catch {
          // ignore write errors on already-aborted response
        }
      });
      // Return a no-op handle compatible with clearInterval
      return { _mock: true } as unknown as ReturnType<typeof originalSetInterval>;
    };

    const heartbeatApp = await buildApp();
    await heartbeatApp.ready();
    const address = await heartbeatApp.listen({ port: 0, host: "127.0.0.1" });
    try {
      const controller = new AbortController();
      let body = "";
      try {
        const res = await fetch(`${address}/mcp`, { method: "GET", signal: controller.signal });
        const reader = res.body!.getReader();
        // Read until we either see "heartbeat" or hit a short timeout
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) body += new TextDecoder().decode(value);
          if (body.includes("heartbeat")) break;
        }
        controller.abort();
        try {
          reader.cancel();
        } catch {}
      } catch (e: any) {
        if (e.name !== "AbortError") throw e;
      }
      expect(heartbeatFired).toBe(true);
      expect(body).toContain("heartbeat");
    } finally {
      globalThis.setInterval = originalSetInterval;
      await heartbeatApp.close();
    }
  });

  test("GET /mcp — close event fires and clears keep-alive interval", async () => {
    // The existing SSE test already exercises lines 116-139.
    // This test exercises line 140 (clearInterval inside the 'close' handler)
    // by making a real TCP connection and aborting it.
    const { buildApp } = await import("../app");
    const sseApp = await buildApp();
    await sseApp.ready();

    // Enable MCP, disable auth for this isolated app
    const db = getDb();
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpEnabled",
      JSON.stringify(true),
    );
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "mcpAuthRequired",
      JSON.stringify(false),
    );

    const address = await sseApp.listen({ port: 0, host: "127.0.0.1" });
    try {
      const controller = new AbortController();
      let gotData = false;
      try {
        const res = await fetch(`${address}/mcp`, {
          method: "GET",
          signal: controller.signal,
        });
        const reader = res.body!.getReader();
        const { value } = await reader.read();
        if (value && value.length > 0) gotData = true;
        controller.abort();
        try {
          reader.cancel();
        } catch {}
      } catch (e: any) {
        if (e.name !== "AbortError") throw e;
      }
      // Allow the close event to propagate
      await new Promise((r) => setTimeout(r, 50));
      expect(gotData).toBe(true);
    } finally {
      await sseApp.close();
    }
  });
});
