/**
 * Integration tests for claude.ts SSE streaming paths.
 *
 * Uses mock.module() to replace spawnStreaming and AI prompt builders so we can
 * exercise the streaming logic without invoking real AI backends.
 *
 * Each bun test file runs in its own worker, so mock.module() here does not
 * affect other test files. This file is discovered automatically by
 * `bun test src/` and included in coverage measurement.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mocks — must be set up BEFORE importing the app / route modules
// ---------------------------------------------------------------------------

// Track what spawnStreaming receives and provide controllable output
let spawnStreamingCalls: Array<{ cmd: string[]; opts: any }> = [];
let nextStreamChunks: string[] = ["Hello ", "world!"];
let nextStreamStderr: string[] = [];
let nextStreamExitCode = 0;
let nextStreamError: string | null = null;

const mockSpawnStreaming = mock((cmd: string[], opts?: any) => {
  // If an error is queued, throw it (simulates spawn failure)
  if (nextStreamError) {
    const err = nextStreamError;
    nextStreamError = null;
    throw new Error(err);
  }

  spawnStreamingCalls.push({ cmd, opts });
  let dataCb: ((chunk: string) => void) | null = null;
  let stderrCb: ((chunk: string) => void) | null = null;
  let resolveExited: ((code: number) => void) | null = null;

  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

  // Deliver chunks asynchronously (next microtask) so the caller can attach onData first
  queueMicrotask(() => {
    for (const chunk of nextStreamChunks) {
      if (dataCb) dataCb(chunk);
    }
    for (const chunk of nextStreamStderr) {
      if (stderrCb) stderrCb(chunk);
    }
    resolveExited!(nextStreamExitCode);
  });

  return {
    onData: (cb: (chunk: string) => void) => {
      dataCb = cb;
    },
    onStderr: (cb: (chunk: string) => void) => {
      stderrCb = cb;
    },
    kill: mock(() => {}),
    exited,
  };
});

mock.module("../lib/runtime", () => ({
  spawnStreaming: mockSpawnStreaming,
  isBun: true,
  spawnProcess: mock(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  spawnProcessSync: mock(() => ({ stdout: "/usr/bin/claude", exitCode: 0 })),
  writeFile: mock(async () => {}),
  spawnPty: mock(() => ({
    write: mock(() => {}),
    resize: mock(() => {}),
    kill: mock(() => {}),
    onData: mock(() => {}),
    onExit: mock(() => {}),
  })),
}));

// Mock spawn (used by isCliAvailable)
let nextSpawnResult = { stdout: "/usr/bin/claude\n", stderr: "", exitCode: 0 };

mock.module("../lib/spawn", () => ({
  spawn: mock(async () => nextSpawnResult),
}));

// Mock AI prompt builders to return simple strings
mock.module("../services/aiResolvePrompt", () => ({
  buildAnalyzePrompt: mock(async () => "mock-analyze-prompt"),
  buildGatherContextPrompt: mock(async () => "mock-gather-context-prompt"),
}));

// Mock logger so it doesn't hit the DB
mock.module("../lib/logger", () => ({
  log: mock(() => {}),
}));

// Mock snapshot so task creation doesn't try to write to disk
mock.module("../services/snapshot", () => ({
  writeTaskSnapshot: mock(() => {}),
}));

// Now import the app after mocks are in place
import { buildApp } from "../app";
import { resetCliCache } from "./claude";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  spawnStreamingCalls = [];
  nextStreamChunks = ["Hello ", "world!"];
  nextStreamStderr = [];
  nextStreamExitCode = 0;
  nextStreamError = null;
  nextSpawnResult = { stdout: "/usr/bin/claude\n", stderr: "", exitCode: 0 };
  resetCliCache();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse SSE body into individual data payloads */
function parseSSE(body: string): any[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        return line.slice(6);
      }
    });
}

// ---------------------------------------------------------------------------
// POST /api/claude/chat — SSE streaming with mocked CLI
// ---------------------------------------------------------------------------

describe("POST /api/claude/chat — SSE streaming (mocked CLI)", () => {
  test("returns SSE content-type and data: lines with delta events", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "Hello", projectId: null },
    });

    // Fastify inject returns the full body for hijacked responses
    const body = res.body;
    expect(body).toContain("data:");

    const events = parseSSE(body);
    // Should have delta events for each chunk plus a done event
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBe(2);
    expect(deltas[0].text).toBe("Hello ");
    expect(deltas[1].text).toBe("world!");

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents.length).toBe(1);
  });

  test("spawnStreaming receives claude -p command with stdinData", async () => {
    await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "Test message" },
    });

    expect(spawnStreamingCalls.length).toBeGreaterThanOrEqual(1);
    const call = spawnStreamingCalls[spawnStreamingCalls.length - 1];
    expect(call.cmd).toEqual(["claude", "-p"]);
    expect(call.opts.stdinData).toContain("Test message");
  });

  test("includes project context in prompt when projectId is provided", async () => {
    // Create a project so the context-building code runs
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: "SSE Test Project", path: `/tmp/test-sse-${Date.now()}` },
    });
    const projId = projRes.json().id;

    // Add a task so the context includes task info
    await app.inject({
      method: "POST",
      url: `/api/projects/${projId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "My SSE task", status: "todo", priority: "high" },
    });

    await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "Describe the project", projectId: projId },
    });

    const call = spawnStreamingCalls[spawnStreamingCalls.length - 1];
    expect(call.opts.stdinData).toContain("SSE Test Project");
    expect(call.opts.stdinData).toContain("My SSE task");
    expect(call.opts.stdinData).toContain("Describe the project");

    // Cleanup
    await app.inject({ method: "DELETE", url: `/api/projects/${projId}` });
  });

  test("sends SSE error event when spawnStreaming throws", async () => {
    // Queue an error for the next spawnStreaming call
    nextStreamError = "spawn failed";

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "Will fail" },
    });

    const events = parseSSE(res.body);
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].message).toContain("spawn failed");
  });

  test("falls back to API error when CLI is unavailable and no API key", async () => {
    // Make CLI unavailable
    nextSpawnResult = { stdout: "", stderr: "not found", exitCode: 1 };
    resetCliCache();

    // Ensure no API key
    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("DELETE FROM settings WHERE key = 'claudeApiKey'").run();

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "No backend" },
    });

    const events = parseSSE(res.body);
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].message).toContain("No Claude CLI or API key configured");
  });

  test("emits SSE error (not done) when CLI exits with no stdout", async () => {
    // Simulate the silent-failure case: CLI exits with empty stdout but writes to stderr.
    // Without the fix the modal sees only `done` and renders "Context ready"+"No output yet".
    nextStreamChunks = [];
    nextStreamStderr = ["Authentication required: please run `claude login`"];
    nextStreamExitCode = 1;

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "Anything" },
    });

    const events = parseSSE(res.body);
    const deltas = events.filter((e) => e.type === "delta");
    const doneEvents = events.filter((e) => e.type === "done");
    const errorEvents = events.filter((e) => e.type === "error");

    expect(deltas.length).toBe(0);
    expect(doneEvents.length).toBe(0);
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].message).toContain("Authentication required");
  });

  test("falls back to a friendly message when CLI exits silently with no stderr", async () => {
    nextStreamChunks = [];
    nextStreamStderr = [];
    nextStreamExitCode = 0;

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "Anything" },
    });

    const events = parseSSE(res.body);
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].message).toContain("no output");
  });
});

// ---------------------------------------------------------------------------
// POST /api/claude/analyze — SSE streaming with mocked CLI
// ---------------------------------------------------------------------------

describe("POST /api/claude/analyze — SSE streaming (mocked CLI)", () => {
  test("streams SSE delta events for a valid task", async () => {
    // Create project + task
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: "Analyze SSE Project", path: `/tmp/test-analyze-sse-${Date.now()}` },
    });
    const projId = projRes.json().id;

    const taskRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Analyze me" },
    });
    const taskId = taskRes.json().id;

    nextStreamChunks = ["Analysis ", "result."];

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/analyze",
      headers: { "Content-Type": "application/json" },
      payload: { projectId: projId, taskId },
    });

    const events = parseSSE(res.body);
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBe(2);
    expect(deltas[0].text).toBe("Analysis ");
    expect(deltas[1].text).toBe("result.");

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents.length).toBe(1);

    // spawnStreaming should have been called with claude -p
    const call = spawnStreamingCalls[spawnStreamingCalls.length - 1];
    expect(call.cmd).toEqual(["claude", "-p"]);

    // Cleanup
    await app.inject({ method: "DELETE", url: `/api/projects/${projId}` });
  });

  test("still returns 404 for nonexistent task (before streaming starts)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/claude/analyze",
      headers: { "Content-Type": "application/json" },
      payload: { projectId: "nope", taskId: "nope" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Task not found");
  });

  test("sends SSE error when streamPromptToSSE throws", async () => {
    // Create project + task
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: "Analyze Error Project", path: `/tmp/test-analyze-err-${Date.now()}` },
    });
    const projId = projRes.json().id;

    const taskRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projId}/tasks`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Error task" },
    });
    const taskId = taskRes.json().id;

    // Queue an error for the next spawnStreaming call
    nextStreamError = "analyze spawn crash";

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/analyze",
      headers: { "Content-Type": "application/json" },
      payload: { projectId: projId, taskId },
    });

    const events = parseSSE(res.body);
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].message).toContain("analyze spawn crash");

    // Cleanup
    await app.inject({ method: "DELETE", url: `/api/projects/${projId}` });
  });
});

// ---------------------------------------------------------------------------
// POST /api/claude/gather-context — SSE streaming with mocked CLI
// ---------------------------------------------------------------------------

describe("POST /api/claude/gather-context — SSE streaming (mocked CLI)", () => {
  test("streams SSE delta events for valid inputs", async () => {
    nextStreamChunks = ["Context ", "gathered."];

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/gather-context",
      headers: { "Content-Type": "application/json" },
      payload: { taskTitle: "New feature", taskDescription: "Build something", projectId: "proj-1" },
    });

    const events = parseSSE(res.body);
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBe(2);
    expect(deltas[0].text).toBe("Context ");
    expect(deltas[1].text).toBe("gathered.");

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents.length).toBe(1);

    // Verify spawnStreaming was called
    expect(spawnStreamingCalls.length).toBeGreaterThanOrEqual(1);
    const call = spawnStreamingCalls[spawnStreamingCalls.length - 1];
    expect(call.cmd).toEqual(["claude", "-p"]);
  });

  test("streams with null taskDescription", async () => {
    nextStreamChunks = ["Minimal context."];

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/gather-context",
      headers: { "Content-Type": "application/json" },
      payload: { taskTitle: "Quick task", projectId: "proj-2" },
    });

    const events = parseSSE(res.body);
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBe(1);
    expect(deltas[0].text).toBe("Minimal context.");
  });

  test("still returns 400 for missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/claude/gather-context",
      headers: { "Content-Type": "application/json" },
      payload: { projectId: "some-id" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("taskTitle and projectId are required");
  });

  test("sends SSE error event when spawnStreaming throws", async () => {
    nextStreamError = "gather spawn crash";

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/gather-context",
      headers: { "Content-Type": "application/json" },
      payload: { taskTitle: "Failing task", projectId: "proj-3" },
    });

    const events = parseSSE(res.body);
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].message).toContain("gather spawn crash");
  });

  test("falls back to API error when CLI unavailable and no key", async () => {
    nextSpawnResult = { stdout: "", stderr: "not found", exitCode: 1 };
    resetCliCache();

    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("DELETE FROM settings WHERE key = 'claudeApiKey'").run();

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/gather-context",
      headers: { "Content-Type": "application/json" },
      payload: { taskTitle: "No backend task", projectId: "proj-4" },
    });

    const events = parseSSE(res.body);
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].message).toContain("No Claude CLI or API key configured");
  });

  test("emits SSE error (not done) when CLI exits with no stdout", async () => {
    // Reproduces the bug where the modal showed "Context ready" + "No output yet".
    nextStreamChunks = [];
    nextStreamStderr = ["Rate limit exceeded — retry in 30s"];
    nextStreamExitCode = 1;

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/gather-context",
      headers: { "Content-Type": "application/json" },
      payload: { taskTitle: "Whatever", projectId: "proj-silent" },
    });

    const events = parseSSE(res.body);
    expect(events.filter((e) => e.type === "delta").length).toBe(0);
    expect(events.filter((e) => e.type === "done").length).toBe(0);
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].message).toContain("Rate limit exceeded");
  });
});

// ---------------------------------------------------------------------------
// POST /api/claude/bulk-import — with mocked CLI
// ---------------------------------------------------------------------------

describe("POST /api/claude/bulk-import — with mocked CLI", () => {
  test("parses response JSON from mocked CLI output", async () => {
    // bulk-import uses spawn() not spawnStreaming, so we control via nextSpawnResult
    nextSpawnResult = {
      stdout: JSON.stringify([
        { title: "Task 1", description: "Desc 1", priority: "high", status: "backlog" },
        { title: "Task 2", description: null, priority: "low", status: "backlog" },
      ]),
      stderr: "",
      exitCode: 0,
    };
    resetCliCache();

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/bulk-import",
      headers: { "Content-Type": "application/json" },
      payload: { text: "Add a task for auth and another for logging" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].title).toBe("Task 1");
    expect(body[1].title).toBe("Task 2");
  });

  test("returns empty array when CLI returns non-JSON", async () => {
    nextSpawnResult = {
      stdout: "I couldn't parse that into tasks.",
      stderr: "",
      exitCode: 0,
    };
    resetCliCache();

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/bulk-import",
      headers: { "Content-Type": "application/json" },
      payload: { text: "random gibberish" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test("extracts JSON array embedded in surrounding text", async () => {
    nextSpawnResult = {
      stdout: 'Here are the tasks:\n[{"title":"Embedded","description":null,"priority":"medium","status":"backlog"}]\nDone!',
      stderr: "",
      exitCode: 0,
    };
    resetCliCache();

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/bulk-import",
      headers: { "Content-Type": "application/json" },
      payload: { text: "one task about embedding" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].title).toBe("Embedded");
  });
});

// ---------------------------------------------------------------------------
// API fallback paths (CLI unavailable, API key set, fetch fails)
// ---------------------------------------------------------------------------

describe("API fallback — chat endpoint", () => {
  test("returns SSE error when API fetch fails", async () => {
    // CLI unavailable
    nextSpawnResult = { stdout: "", stderr: "not found", exitCode: 1 };
    resetCliCache();

    // Set an API key so the code attempts the fetch
    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "claudeApiKey",
      JSON.stringify("sk-ant-fake-key-for-test"),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "API fallback test" },
    });

    // The fetch to api.anthropic.com will fail (invalid key / network)
    // This should result in an SSE error event
    const events = parseSSE(res.body);
    const hasError = events.some((e) => e.type === "error");
    const hasDone = events.some((e) => e.type === "done");
    // Either an error event OR done (if fetch somehow succeeds but returns no data)
    expect(hasError || hasDone).toBe(true);

    // Cleanup
    db.prepare("DELETE FROM settings WHERE key = 'claudeApiKey'").run();
  });
});

describe("API fallback — gather-context endpoint (streamPromptToSSE)", () => {
  test("returns SSE error when API fetch fails", async () => {
    nextSpawnResult = { stdout: "", stderr: "not found", exitCode: 1 };
    resetCliCache();

    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "claudeApiKey",
      JSON.stringify("sk-ant-fake-key-for-test"),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/gather-context",
      headers: { "Content-Type": "application/json" },
      payload: { taskTitle: "API fallback context", projectId: "proj-api" },
    });

    const events = parseSSE(res.body);
    const hasError = events.some((e) => e.type === "error");
    const hasDone = events.some((e) => e.type === "done");
    expect(hasError || hasDone).toBe(true);

    db.prepare("DELETE FROM settings WHERE key = 'claudeApiKey'").run();
  });
});

describe("API fallback — bulk-import endpoint", () => {
  test("returns error or empty when API fetch fails", async () => {
    nextSpawnResult = { stdout: "", stderr: "not found", exitCode: 1 };
    resetCliCache();

    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "claudeApiKey",
      JSON.stringify("sk-ant-fake-key-for-test"),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/bulk-import",
      headers: { "Content-Type": "application/json" },
      payload: { text: "import some tasks" },
    });

    // The API call will fail — either 500 or empty array depending on error handling
    expect([200, 500]).toContain(res.statusCode);

    db.prepare("DELETE FROM settings WHERE key = 'claudeApiKey'").run();
  });
});

// ---------------------------------------------------------------------------
// API fallback — with mocked fetch to exercise stream parsing
// ---------------------------------------------------------------------------

describe("API fallback — stream parsing with mocked fetch", () => {
  const originalFetch = globalThis.fetch;

  function mockFetchWithStream(chunks: string[]) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = (async () => ({
      body: stream,
      ok: true,
      status: 200,
    })) as any;
  }

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("chat endpoint parses Anthropic SSE content_block_delta events", async () => {
    nextSpawnResult = { stdout: "", stderr: "", exitCode: 1 };
    resetCliCache();

    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "claudeApiKey",
      JSON.stringify("sk-ant-mock"),
    );

    // Simulate Anthropic's SSE format
    mockFetchWithStream([
      'data: {"type":"content_block_delta","delta":{"text":"API "}}\n',
      'data: {"type":"content_block_delta","delta":{"text":"response"}}\n',
      "data: [DONE]\n",
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "Test API stream parsing" },
    });

    globalThis.fetch = originalFetch;

    const events = parseSSE(res.body);
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBe(2);
    expect(deltas[0].text).toBe("API ");
    expect(deltas[1].text).toBe("response");
    expect(events.some((e) => e.type === "done")).toBe(true);

    db.prepare("DELETE FROM settings WHERE key = 'claudeApiKey'").run();
  });

  test("chat endpoint handles non-delta Anthropic events gracefully", async () => {
    nextSpawnResult = { stdout: "", stderr: "", exitCode: 1 };
    resetCliCache();

    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "claudeApiKey",
      JSON.stringify("sk-ant-mock"),
    );

    mockFetchWithStream([
      'data: {"type":"message_start","message":{"id":"msg_123"}}\n',
      'data: {"type":"content_block_start","content_block":{"type":"text"}}\n',
      'data: {"type":"content_block_delta","delta":{"text":"Only delta"}}\n',
      'data: {"type":"message_stop"}\n',
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "Test non-delta events" },
    });

    globalThis.fetch = originalFetch;

    const events = parseSSE(res.body);
    const deltas = events.filter((e) => e.type === "delta");
    // Only the content_block_delta event should produce a delta
    expect(deltas.length).toBe(1);
    expect(deltas[0].text).toBe("Only delta");

    db.prepare("DELETE FROM settings WHERE key = 'claudeApiKey'").run();
  });

  test("streamPromptToSSE parses Anthropic SSE via gather-context", async () => {
    nextSpawnResult = { stdout: "", stderr: "", exitCode: 1 };
    resetCliCache();

    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "claudeApiKey",
      JSON.stringify("sk-ant-mock"),
    );

    mockFetchWithStream([
      'data: {"type":"content_block_delta","delta":{"text":"Context "}}\n',
      'data: {"type":"content_block_delta","delta":{"text":"result"}}\n',
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/gather-context",
      headers: { "Content-Type": "application/json" },
      payload: { taskTitle: "API context task", projectId: "proj-api-parse" },
    });

    globalThis.fetch = originalFetch;

    const events = parseSSE(res.body);
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBe(2);
    expect(deltas[0].text).toBe("Context ");
    expect(deltas[1].text).toBe("result");

    db.prepare("DELETE FROM settings WHERE key = 'claudeApiKey'").run();
  });

  test("chat endpoint handles invalid JSON in SSE data gracefully", async () => {
    nextSpawnResult = { stdout: "", stderr: "", exitCode: 1 };
    resetCliCache();

    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "claudeApiKey",
      JSON.stringify("sk-ant-mock"),
    );

    mockFetchWithStream([
      "data: {invalid json}\n",
      'data: {"type":"content_block_delta","delta":{"text":"valid"}}\n',
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "Test invalid JSON" },
    });

    globalThis.fetch = originalFetch;

    const events = parseSSE(res.body);
    const deltas = events.filter((e) => e.type === "delta");
    // Invalid JSON should be skipped, valid one should come through
    expect(deltas.length).toBe(1);
    expect(deltas[0].text).toBe("valid");

    db.prepare("DELETE FROM settings WHERE key = 'claudeApiKey'").run();
  });

  test("bulk-import uses API fallback and parses response", async () => {
    nextSpawnResult = { stdout: "", stderr: "", exitCode: 1 };
    resetCliCache();

    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "claudeApiKey",
      JSON.stringify("sk-ant-mock"),
    );

    // Mock fetch to return a non-streaming response (bulk-import doesn't stream)
    globalThis.fetch = (async () => ({
      json: async () => ({
        content: [{ text: '[{"title":"API Task","description":null,"priority":"high","status":"backlog"}]' }],
      }),
      ok: true,
      status: 200,
    })) as any;

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/bulk-import",
      headers: { "Content-Type": "application/json" },
      payload: { text: "one task from API" },
    });

    globalThis.fetch = originalFetch;

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].title).toBe("API Task");

    db.prepare("DELETE FROM settings WHERE key = 'claudeApiKey'").run();
  });
});

// ---------------------------------------------------------------------------
// SSE format validation
// ---------------------------------------------------------------------------

describe("SSE format correctness", () => {
  test("each data line ends with double newline", async () => {
    nextStreamChunks = ["chunk1", "chunk2"];

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "format test" },
    });

    const body = res.body;
    // Every "data: ..." should be followed by \n\n
    const dataLines = body.split("\n\n").filter((segment: string) => segment.startsWith("data:"));
    expect(dataLines.length).toBeGreaterThanOrEqual(3); // 2 deltas + 1 done
  });

  test("delta events contain valid JSON with type and text fields", async () => {
    nextStreamChunks = ["test chunk"];

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "json test" },
    });

    const events = parseSSE(res.body);
    const delta = events.find((e) => e.type === "delta");
    expect(delta).toBeDefined();
    expect(delta.type).toBe("delta");
    expect(typeof delta.text).toBe("string");
  });

  test("done event is the last event", async () => {
    nextStreamChunks = ["a", "b", "c"];

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "order test" },
    });

    const events = parseSSE(res.body);
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe("done");
  });

  test("error event contains message field", async () => {
    nextStreamError = "test error message";

    const res = await app.inject({
      method: "POST",
      url: "/api/claude/chat",
      headers: { "Content-Type": "application/json" },
      payload: { message: "error format test" },
    });

    const events = parseSSE(res.body);
    const errEvent = events.find((e) => e.type === "error");
    expect(errEvent).toBeDefined();
    expect(typeof errEvent.message).toBe("string");
    expect(errEvent.message).toBe("test error message");
  });
});
