import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { buildApp } from "../app";
import * as termService from "../services/terminalService";
import { mkdirSync, rmSync } from "node:fs";

let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;
const createdSessionIds: string[] = [];
const testDir = `/tmp/terminal-test-${Date.now()}`;

beforeAll(async () => {
  // Create a real directory so PTY spawn can use it as cwd
  mkdirSync(testDir, { recursive: true });

  app = await buildApp();
  await app.ready();

  // Create a test project pointing to the real directory
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { "Content-Type": "application/json" },
    payload: {
      name: `Terminal Test Project ${Date.now()}`,
      path: testDir,
    },
  });
  projectId = res.json().id;
});

afterAll(async () => {
  // Kill any sessions created during tests to avoid orphaned processes
  for (const id of createdSessionIds) {
    try {
      termService.killSession(id);
    } catch {}
  }
  // Also kill any remaining sessions that may have been created
  for (const s of termService.listSessions()) {
    try {
      termService.killSession(s.id);
    } catch {}
  }
  // Clean up test project
  await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  

  // Remove test directory
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

// ---------------------------------------------------------------------------
// Terminal Status
// ---------------------------------------------------------------------------

describe("Terminal Status", () => {
  test("GET /api/terminal/status — returns availability", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/terminal/status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.available).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// Session CRUD lifecycle
// ---------------------------------------------------------------------------

describe("Terminal Sessions CRUD", () => {
  let sessionId: string;

  test("GET /api/terminal/sessions — returns array (initially may be empty)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/terminal/sessions",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("POST /api/terminal/sessions — create a shell session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/sessions",
      headers: { "Content-Type": "application/json" },
      payload: {
        type: "shell",
        projectId,
        cols: 80,
        rows: 24,
        name: "test-shell",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.type).toBe("shell");
    expect(body.projectId).toBe(projectId);
    expect(body.name).toBe("test-shell");
    expect(body.alive).toBe(true);
    expect(body.cwd).toBeDefined();

    sessionId = body.id;
    createdSessionIds.push(sessionId);
  });

  test("GET /api/terminal/sessions — lists created session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/terminal/sessions",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const found = body.find((s: any) => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found.type).toBe("shell");
    expect(found.projectId).toBe(projectId);
    expect(found.alive).toBe(true);
  });

  test("GET /api/terminal/sessions?projectId= — filters by project", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/terminal/sessions?projectId=${projectId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    // All returned sessions should belong to the project
    for (const s of body) {
      expect(s.projectId).toBe(projectId);
    }
  });

  test("GET /api/terminal/sessions?projectId= — returns empty for unknown project", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/terminal/sessions?projectId=nonexistent-project-id",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test("POST /api/terminal/sessions/:sessionId/write — write to session", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/terminal/sessions/${sessionId}/write`,
      headers: { "Content-Type": "application/json" },
      payload: { data: "echo hello\n" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
  });

  test("POST /api/terminal/sessions/:sessionId/write — returns 404 for nonexistent session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/sessions/nonexistent-session/write",
      headers: { "Content-Type": "application/json" },
      payload: { data: "echo hello\n" },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBeDefined();
  });

  test("DELETE /api/terminal/sessions/:sessionId — kill session", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/terminal/sessions/${sessionId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
  });

  test("DELETE /api/terminal/sessions/nonexistent — returns 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/terminal/sessions/nonexistent-session-id",
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Session not found");
  });

  test("GET /api/terminal/sessions — session is gone after delete", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/terminal/sessions",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const found = body.find((s: any) => s.id === sessionId);
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Session type validation
// ---------------------------------------------------------------------------

describe("Session Type Validation", () => {
  test("POST /api/terminal/sessions — rejects invalid session type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/sessions",
      headers: { "Content-Type": "application/json" },
      payload: {
        type: "invalid-type",
        projectId,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Invalid session type");
  });

  test("POST /api/terminal/sessions — defaults type to shell when omitted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/sessions",
      headers: { "Content-Type": "application/json" },
      payload: { projectId },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe("shell");
    expect(body.id).toBeDefined();
    createdSessionIds.push(body.id);
  });
});

// ---------------------------------------------------------------------------
// Session creation error handling
// ---------------------------------------------------------------------------

describe("Session Creation Error", () => {
  test("POST /api/terminal/sessions — returns 500 when createSession throws", async () => {
    const spy = spyOn(termService, "createSession").mockRejectedValueOnce(
      new Error("Simulated PTY spawn failure"),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/sessions",
      headers: { "Content-Type": "application/json" },
      payload: { type: "shell", projectId },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("Simulated PTY spawn failure");

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// AI Sessions endpoint
// ---------------------------------------------------------------------------

describe("AI Sessions", () => {
  test("GET /api/terminal/ai-sessions — returns array of sessions with taskId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/terminal/ai-sessions",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    // All returned sessions should have a taskId
    for (const s of body) {
      expect(s.taskId).toBeDefined();
      expect(s.taskId).not.toBeNull();
    }
  });

  test("GET /api/terminal/ai-sessions — returns session created with taskId", async () => {
    // Mock listSessions to return a session with a taskId
    const fakeSession = {
      id: "fake-ai-session",
      type: "ai-resolve",
      projectId,
      taskId: "fake-task-id",
      name: "AI Resolve: fake task",
      cwd: testDir,
      alive: true,
      ws: null,
      proc: null,
      outputBuffer: [],
      exitBuffer: null,
      scrollback: "",
    };
    const spy = spyOn(termService, "listSessions").mockReturnValueOnce([fakeSession as any]);

    const res = await app.inject({
      method: "GET",
      url: "/api/terminal/ai-sessions",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].id).toBe("fake-ai-session");
    expect(body[0].taskId).toBe("fake-task-id");
    expect(body[0].type).toBe("ai-resolve");
    expect(body[0].name).toBe("AI Resolve: fake task");
    // Internal fields should not be exposed
    expect(body[0]).not.toHaveProperty("proc");
    expect(body[0]).not.toHaveProperty("ws");
    expect(body[0]).not.toHaveProperty("scrollback");

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Batch Resolve
// ---------------------------------------------------------------------------

describe("Batch Resolve", () => {
  test("POST /api/terminal/batch-resolve — rejects missing projectId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/batch-resolve",
      headers: { "Content-Type": "application/json" },
      payload: { taskIds: ["task-1"] },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("projectId and taskIds are required");
  });

  test("POST /api/terminal/batch-resolve — rejects missing taskIds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/batch-resolve",
      headers: { "Content-Type": "application/json" },
      payload: { projectId },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("projectId and taskIds are required");
  });

  test("POST /api/terminal/batch-resolve — rejects empty taskIds array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/batch-resolve",
      headers: { "Content-Type": "application/json" },
      payload: { projectId, taskIds: [] },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("projectId and taskIds are required");
  });

  test("GET /api/terminal/batch-resolve/status — returns status object", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/terminal/batch-resolve/status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // BatchResolveStatus has a 'state' field
    expect(body.state).toBeDefined();
    expect(["idle", "running", "completed", "cancelled"]).toContain(body.state);
    expect(typeof body.totalTasks).toBe("number");
    expect(typeof body.completedTasks).toBe("number");
    expect(Array.isArray(body.taskResults)).toBe(true);
  });

  test("POST /api/terminal/batch-resolve/cancel — cancel when not running", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/batch-resolve/cancel",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // When not running, state should remain idle or become cancelled
    expect(["idle", "cancelled"]).toContain(body.state);
  });

  test("POST /api/terminal/batch-resolve — successful start returns status", async () => {
    const fakeStatus = {
      state: "running",
      totalTasks: 2,
      completedTasks: 0,
      taskResults: [],
    };
    const spy = spyOn(termService, "startBatchResolve").mockResolvedValueOnce(fakeStatus as any);

    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/batch-resolve",
      headers: { "Content-Type": "application/json" },
      payload: { projectId, taskIds: ["task-1", "task-2"], concurrency: 1 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe("running");
    expect(body.totalTasks).toBe(2);
    expect(body.completedTasks).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  test("POST /api/terminal/batch-resolve — returns 409 when already running", async () => {
    const spy = spyOn(termService, "startBatchResolve").mockRejectedValueOnce(
      new Error("Batch resolve already running"),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/batch-resolve",
      headers: { "Content-Type": "application/json" },
      payload: { projectId, taskIds: ["task-1"] },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("Batch resolve already running");

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Multiple sessions
// ---------------------------------------------------------------------------

describe("Multiple Sessions", () => {
  const multiSessionIds: string[] = [];

  afterAll(async () => {
    for (const id of multiSessionIds) {
      await app.inject({
        method: "DELETE",
        url: `/api/terminal/sessions/${id}`,
      });
    }
  });

  test("can create multiple sessions and list them all", async () => {
    // Create two sessions
    const res1 = await app.inject({
      method: "POST",
      url: "/api/terminal/sessions",
      headers: { "Content-Type": "application/json" },
      payload: { type: "shell", projectId, name: "multi-1" },
    });
    const res2 = await app.inject({
      method: "POST",
      url: "/api/terminal/sessions",
      headers: { "Content-Type": "application/json" },
      payload: { type: "shell", projectId, name: "multi-2" },
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const id1 = res1.json().id;
    const id2 = res2.json().id;
    multiSessionIds.push(id1, id2);
    createdSessionIds.push(id1, id2);

    // List and verify both are present
    const listRes = await app.inject({
      method: "GET",
      url: `/api/terminal/sessions?projectId=${projectId}`,
    });

    expect(listRes.statusCode).toBe(200);
    const sessions = listRes.json();
    const foundIds = sessions.map((s: any) => s.id);
    expect(foundIds).toContain(id1);
    expect(foundIds).toContain(id2);
  });

  test("deleting one session does not affect the other", async () => {
    const idToDelete = multiSessionIds[0];
    const idToKeep = multiSessionIds[1];

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/terminal/sessions/${idToDelete}`,
    });
    expect(delRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: "GET",
      url: "/api/terminal/sessions",
    });

    const sessions = listRes.json();
    const found = sessions.find((s: any) => s.id === idToKeep);
    expect(found).toBeDefined();

    const deleted = sessions.find((s: any) => s.id === idToDelete);
    expect(deleted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Response shape validation
// ---------------------------------------------------------------------------

describe("Response Shape", () => {
  let sessionId: string;

  afterAll(async () => {
    if (sessionId) {
      await app.inject({
        method: "DELETE",
        url: `/api/terminal/sessions/${sessionId}`,
      });
    }
  });

  test("session response contains expected fields and no internals", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/terminal/sessions",
      headers: { "Content-Type": "application/json" },
      payload: { type: "shell", projectId, name: "shape-test" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    sessionId = body.id;
    createdSessionIds.push(sessionId);

    // Expected fields
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("type");
    expect(body).toHaveProperty("projectId");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("cwd");
    expect(body).toHaveProperty("alive");

    // Internal fields should NOT be exposed via the REST API
    expect(body).not.toHaveProperty("proc");
    expect(body).not.toHaveProperty("ws");
    expect(body).not.toHaveProperty("outputBuffer");
    expect(body).not.toHaveProperty("exitBuffer");
    expect(body).not.toHaveProperty("scrollback");
  });
});
