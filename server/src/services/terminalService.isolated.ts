import { describe, test, expect, beforeEach, mock } from "bun:test";

// Mock getDb before importing terminalService so resolveCwd/killSession don't hit a real DB
const mockPrepare = mock(() => ({
  get: mock((..._args: any[]) => undefined as any),
  all: mock((..._args: any[]) => [] as any[]),
  run: mock((..._args: any[]) => {}),
}));

mock.module("../db", () => ({
  getDb: () => ({
    prepare: mockPrepare,
    exec: mock(() => {}),
  }),
}));

// Mock logger so it doesn't try to use DB
mock.module("../lib/logger", () => ({
  log: mock(() => {}),
}));

// Mock runtime so spawnProcessSync doesn't actually run processes
// We keep a reference to the mock so tests can inspect calls
let spawnPtyCalls: Array<{ cmd: string; args: string[]; opts: any }> = [];
let latestPtyOnData: ((data: string) => void) | null = null;
let latestPtyOnExit: ((exitCode: number) => void) | null = null;

const mockSpawnPty = mock((cmd: string, args: string[], opts: any) => {
  spawnPtyCalls.push({ cmd, args, opts });
  const handle = {
    write: mock(() => {}),
    resize: mock(() => {}),
    kill: mock(() => {}),
    onData: mock((cb: (data: string) => void) => { latestPtyOnData = cb; }),
    onExit: mock((cb: (exitCode: number) => void) => { latestPtyOnExit = cb; }),
  };
  return handle;
});

mock.module("../lib/runtime", () => ({
  spawnPty: mockSpawnPty,
  spawnProcessSync: mock((_cmd: string[], _opts: any) => ({
    stdout: "/usr/bin/claude\n",
    exitCode: 0,
  })),
}));

// Mock aiResolvePrompt
mock.module("./aiResolvePrompt", () => ({
  buildAiResolvePrompt: mock(async () => "test prompt"),
  buildAiTestPrompt: mock(async () => "test prompt"),
}));

import {
  getSafeEnv,
  SAFE_ENV_KEYS,
  MAX_SCROLLBACK_CHARS,
  generateId,
  _resetIdCounter,
  sessions,
  emitData,
  emitExit,
  resolveClaudeCmd,
  resolveCwd,
  listSessions,
  getSession,
  killSession,
  attachWs,
  detachWs,
  writeToSession,
  resizeSession,
  getBatchResolveStatus,
  createSession,
  type PtySession,
} from "./terminalService";

// ── Helpers ──────────────────────────────────────────────────

function makeMockSession(overrides: Partial<PtySession> = {}): PtySession {
  return {
    id: overrides.id ?? "test-session-1",
    proc: overrides.proc ?? null,
    cwd: overrides.cwd ?? "/tmp",
    type: overrides.type ?? "shell",
    projectId: overrides.projectId,
    taskId: overrides.taskId,
    name: overrides.name,
    alive: overrides.alive ?? true,
    ws: overrides.ws ?? null,
    outputBuffer: overrides.outputBuffer ?? [],
    exitBuffer: overrides.exitBuffer ?? null,
    scrollback: overrides.scrollback ?? "",
  };
}

function makeMockWs(readyState = 1) {
  return {
    readyState,
    sent: [] as string[],
    send(data: string) { this.sent.push(data); },
    close() { this.readyState = 3; },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("terminalService unit tests", () => {
  beforeEach(() => {
    // Clear all sessions between tests
    sessions.clear();
    _resetIdCounter();
    spawnPtyCalls = [];
    latestPtyOnData = null;
    latestPtyOnExit = null;
    mockSpawnPty.mockClear();
  });

  // ── SAFE_ENV_KEYS ────────────────────────────────────────

  describe("SAFE_ENV_KEYS", () => {
    test("is a Set with expected keys", () => {
      expect(SAFE_ENV_KEYS).toBeInstanceOf(Set);
      expect(SAFE_ENV_KEYS.has("PATH")).toBe(true);
      expect(SAFE_ENV_KEYS.has("HOME")).toBe(true);
      expect(SAFE_ENV_KEYS.has("SHELL")).toBe(true);
      expect(SAFE_ENV_KEYS.has("TERM")).toBe(true);
      expect(SAFE_ENV_KEYS.has("NODE_ENV")).toBe(true);
      expect(SAFE_ENV_KEYS.has("EDITOR")).toBe(true);
    });

    test("does NOT include sensitive keys", () => {
      expect(SAFE_ENV_KEYS.has("AWS_SECRET_KEY")).toBe(false);
      expect(SAFE_ENV_KEYS.has("DATABASE_URL")).toBe(false);
      expect(SAFE_ENV_KEYS.has("API_KEY")).toBe(false);
      expect(SAFE_ENV_KEYS.has("ANTHROPIC_API_KEY")).toBe(false);
      expect(SAFE_ENV_KEYS.has("GITHUB_TOKEN")).toBe(false);
    });

    test("includes Windows-specific keys", () => {
      expect(SAFE_ENV_KEYS.has("SYSTEMROOT")).toBe(true);
      expect(SAFE_ENV_KEYS.has("WINDIR")).toBe(true);
      expect(SAFE_ENV_KEYS.has("COMSPEC")).toBe(true);
      expect(SAFE_ENV_KEYS.has("APPDATA")).toBe(true);
      expect(SAFE_ENV_KEYS.has("LOCALAPPDATA")).toBe(true);
    });
  });

  // ── getSafeEnv ───────────────────────────────────────────

  describe("getSafeEnv", () => {
    test("returns an object (not undefined)", () => {
      const result = getSafeEnv();
      expect(typeof result).toBe("object");
      expect(result).not.toBeNull();
    });

    test("includes PATH from process.env if present", () => {
      const originalPath = process.env.PATH;
      process.env.PATH = "/usr/bin:/usr/local/bin";
      try {
        const result = getSafeEnv();
        expect(result.PATH).toBe("/usr/bin:/usr/local/bin");
      } finally {
        if (originalPath !== undefined) {
          process.env.PATH = originalPath;
        }
      }
    });

    test("excludes non-whitelisted env vars", () => {
      const originalSecret = process.env.MY_SECRET_VAR;
      process.env.MY_SECRET_VAR = "super-secret";
      try {
        const result = getSafeEnv();
        expect(result.MY_SECRET_VAR).toBeUndefined();
      } finally {
        if (originalSecret === undefined) {
          delete process.env.MY_SECRET_VAR;
        } else {
          process.env.MY_SECRET_VAR = originalSecret;
        }
      }
    });

    test("includes LC_* prefixed env vars", () => {
      const originalLc = process.env.LC_CUSTOM_TEST;
      process.env.LC_CUSTOM_TEST = "test-value";
      try {
        const result = getSafeEnv();
        expect(result.LC_CUSTOM_TEST).toBe("test-value");
      } finally {
        if (originalLc === undefined) {
          delete process.env.LC_CUSTOM_TEST;
        } else {
          process.env.LC_CUSTOM_TEST = originalLc;
        }
      }
    });

    test("excludes env vars with empty string values", () => {
      const originalVal = process.env.EDITOR;
      process.env.EDITOR = "";
      try {
        const result = getSafeEnv();
        expect(result.EDITOR).toBeUndefined();
      } finally {
        if (originalVal === undefined) {
          delete process.env.EDITOR;
        } else {
          process.env.EDITOR = originalVal;
        }
      }
    });

    test("all returned keys are either in SAFE_ENV_KEYS or start with LC_", () => {
      const result = getSafeEnv();
      for (const key of Object.keys(result)) {
        const isSafe = SAFE_ENV_KEYS.has(key) || key.startsWith("LC_");
        expect(isSafe).toBe(true);
      }
    });
  });

  // ── MAX_SCROLLBACK_CHARS ─────────────────────────────────

  describe("MAX_SCROLLBACK_CHARS", () => {
    test("is 100,000", () => {
      expect(MAX_SCROLLBACK_CHARS).toBe(100_000);
    });
  });

  // ── generateId ───────────────────────────────────────────

  describe("generateId", () => {
    test("returns a string starting with 'term-'", () => {
      const id = generateId();
      expect(id.startsWith("term-")).toBe(true);
    });

    test("increments the counter portion", () => {
      const id1 = generateId();
      const id2 = generateId();
      // Extract counter from 'term-{counter}-{timestamp}'
      const counter1 = parseInt(id1.split("-")[1], 10);
      const counter2 = parseInt(id2.split("-")[1], 10);
      expect(counter2).toBe(counter1 + 1);
    });

    test("includes a base-36 timestamp portion", () => {
      const id = generateId();
      const parts = id.split("-");
      // term-{counter}-{base36timestamp}
      expect(parts.length).toBe(3);
      const timestamp = parseInt(parts[2], 36);
      expect(timestamp).toBeGreaterThan(0);
    });

    test("generates unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(100);
    });
  });

  // ── emitData ─────────────────────────────────────────────

  describe("emitData", () => {
    test("sends data to WebSocket when connected (readyState=1)", () => {
      const ws = makeMockWs(1);
      const session = makeMockSession({ ws });
      emitData(session, "hello world");
      expect(ws.sent).toHaveLength(1);
      expect(JSON.parse(ws.sent[0])).toEqual({ type: "output", data: "hello world" });
      expect(session.outputBuffer).toHaveLength(0);
    });

    test("buffers data when no WebSocket attached", () => {
      const session = makeMockSession({ ws: null });
      emitData(session, "buffered data");
      expect(session.outputBuffer).toEqual(["buffered data"]);
    });

    test("buffers data when WebSocket readyState is not 1", () => {
      const ws = makeMockWs(0); // CONNECTING state
      const session = makeMockSession({ ws });
      emitData(session, "pending");
      expect(session.outputBuffer).toEqual(["pending"]);
      expect(ws.sent).toHaveLength(0);
    });

    test("appends to scrollback on each call", () => {
      const session = makeMockSession();
      emitData(session, "first ");
      emitData(session, "second");
      expect(session.scrollback).toBe("first second");
    });

    test("truncates scrollback when exceeding MAX_SCROLLBACK_CHARS", () => {
      const session = makeMockSession();
      // Fill scrollback to just under max
      session.scrollback = "a".repeat(MAX_SCROLLBACK_CHARS - 5);
      // Now emit 10 more chars, total goes over limit
      emitData(session, "b".repeat(10));
      expect(session.scrollback.length).toBe(MAX_SCROLLBACK_CHARS);
      // Should end with the new data
      expect(session.scrollback.endsWith("b".repeat(10))).toBe(true);
    });

    test("accumulates multiple buffered emissions", () => {
      const session = makeMockSession();
      emitData(session, "line1");
      emitData(session, "line2");
      emitData(session, "line3");
      expect(session.outputBuffer).toEqual(["line1", "line2", "line3"]);
    });
  });

  // ── emitExit ─────────────────────────────────────────────

  describe("emitExit", () => {
    test("sends exit code to WebSocket when connected", () => {
      const ws = makeMockWs(1);
      const session = makeMockSession({ ws });
      emitExit(session, 0);
      expect(ws.sent).toHaveLength(1);
      expect(JSON.parse(ws.sent[0])).toEqual({ type: "exit", exitCode: 0 });
      expect(session.exitBuffer).toBeNull();
    });

    test("buffers exit code when no WebSocket", () => {
      const session = makeMockSession({ ws: null });
      emitExit(session, 42);
      expect(session.exitBuffer).toBe(42);
    });

    test("buffers exit code when WebSocket not open", () => {
      const ws = makeMockWs(0);
      const session = makeMockSession({ ws });
      emitExit(session, 1);
      expect(session.exitBuffer).toBe(1);
      expect(ws.sent).toHaveLength(0);
    });

    test("overwrites previous buffered exit code", () => {
      const session = makeMockSession({ ws: null });
      emitExit(session, 1);
      emitExit(session, 0);
      expect(session.exitBuffer).toBe(0);
    });
  });

  // ── Session management (sessions Map) ────────────────────

  describe("session management", () => {
    test("sessions Map starts empty (after beforeEach clear)", () => {
      expect(sessions.size).toBe(0);
    });

    test("can add and retrieve a session", () => {
      const session = makeMockSession({ id: "s1" });
      sessions.set("s1", session);
      expect(getSession("s1")).toBe(session);
    });

    test("getSession returns undefined for non-existent id", () => {
      expect(getSession("nonexistent")).toBeUndefined();
    });

    test("listSessions returns all sessions", () => {
      sessions.set("s1", makeMockSession({ id: "s1", projectId: "p1" }));
      sessions.set("s2", makeMockSession({ id: "s2", projectId: "p2" }));
      sessions.set("s3", makeMockSession({ id: "s3", projectId: "p1" }));
      const all = listSessions();
      expect(all).toHaveLength(3);
    });

    test("listSessions filters by projectId", () => {
      sessions.set("s1", makeMockSession({ id: "s1", projectId: "p1" }));
      sessions.set("s2", makeMockSession({ id: "s2", projectId: "p2" }));
      sessions.set("s3", makeMockSession({ id: "s3", projectId: "p1" }));
      const filtered = listSessions("p1");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((s) => s.projectId === "p1")).toBe(true);
    });

    test("listSessions returns empty array when no sessions match projectId", () => {
      sessions.set("s1", makeMockSession({ id: "s1", projectId: "p1" }));
      const filtered = listSessions("p99");
      expect(filtered).toHaveLength(0);
    });
  });

  // ── killSession ──────────────────────────────────────────

  describe("killSession", () => {
    test("returns false for non-existent session", () => {
      expect(killSession("nonexistent")).toBe(false);
    });

    test("removes session from sessions Map", () => {
      const session = makeMockSession({ id: "k1" });
      sessions.set("k1", session);
      expect(sessions.has("k1")).toBe(true);
      killSession("k1");
      expect(sessions.has("k1")).toBe(false);
    });

    test("sets alive to false", () => {
      const session = makeMockSession({ id: "k2", alive: true });
      sessions.set("k2", session);
      killSession("k2");
      expect(session.alive).toBe(false);
    });

    test("calls proc.kill() if proc exists", () => {
      const killMock = mock(() => {});
      const session = makeMockSession({
        id: "k3",
        proc: { write: mock(() => {}), resize: mock(() => {}), kill: killMock, onData: mock(() => {}), onExit: mock(() => {}) },
      });
      sessions.set("k3", session);
      killSession("k3");
      expect(killMock).toHaveBeenCalledTimes(1);
    });

    test("sends exit message and closes WebSocket", () => {
      const ws = makeMockWs(1);
      const session = makeMockSession({ id: "k4", ws });
      sessions.set("k4", session);
      killSession("k4");
      expect(ws.sent).toHaveLength(1);
      expect(JSON.parse(ws.sent[0])).toEqual({ type: "exit", exitCode: 0 });
      expect(ws.readyState).toBe(3); // closed
    });

    test("returns true on successful kill", () => {
      const session = makeMockSession({ id: "k5" });
      sessions.set("k5", session);
      expect(killSession("k5")).toBe(true);
    });
  });

  // ── attachWs ─────────────────────────────────────────────

  describe("attachWs", () => {
    test("returns false for non-existent session", () => {
      const ws = makeMockWs();
      expect(attachWs("nonexistent", ws)).toBe(false);
    });

    test("assigns WebSocket to session", () => {
      const session = makeMockSession({ id: "a1" });
      sessions.set("a1", session);
      const ws = makeMockWs();
      attachWs("a1", ws);
      expect(session.ws).toBe(ws);
    });

    test("flushes buffered output on attach", () => {
      const session = makeMockSession({
        id: "a2",
        outputBuffer: ["line1", "line2"],
      });
      sessions.set("a2", session);
      const ws = makeMockWs();
      attachWs("a2", ws);
      expect(ws.sent).toHaveLength(2);
      expect(JSON.parse(ws.sent[0])).toEqual({ type: "output", data: "line1" });
      expect(JSON.parse(ws.sent[1])).toEqual({ type: "output", data: "line2" });
      expect(session.outputBuffer).toHaveLength(0);
    });

    test("flushes buffered exit code on attach", () => {
      const session = makeMockSession({ id: "a3", exitBuffer: 42 });
      sessions.set("a3", session);
      const ws = makeMockWs();
      attachWs("a3", ws);
      const exitMsg = ws.sent.find((s) => JSON.parse(s).type === "exit");
      expect(exitMsg).toBeDefined();
      expect(JSON.parse(exitMsg!)).toEqual({ type: "exit", exitCode: 42 });
      expect(session.exitBuffer).toBeNull();
    });

    test("sends scrollback history on attach", () => {
      const session = makeMockSession({ id: "a4", scrollback: "previous output" });
      sessions.set("a4", session);
      const ws = makeMockWs();
      attachWs("a4", ws);
      // Scrollback is sent first, then buffered output
      const scrollbackMsg = ws.sent.find((s) => {
        const parsed = JSON.parse(s);
        return parsed.type === "output" && parsed.data === "previous output";
      });
      expect(scrollbackMsg).toBeDefined();
    });

    test("flushes both output and exit in correct order", () => {
      const session = makeMockSession({
        id: "a5",
        outputBuffer: ["data1", "data2"],
        exitBuffer: 0,
      });
      sessions.set("a5", session);
      const ws = makeMockWs();
      attachWs("a5", ws);
      // Output messages come before exit
      const types = ws.sent.map((s) => JSON.parse(s).type);
      const lastOutputIdx = types.lastIndexOf("output");
      const exitIdx = types.indexOf("exit");
      expect(exitIdx).toBeGreaterThan(lastOutputIdx);
    });

    test("returns true on successful attach", () => {
      const session = makeMockSession({ id: "a6" });
      sessions.set("a6", session);
      expect(attachWs("a6", makeMockWs())).toBe(true);
    });
  });

  // ── detachWs ─────────────────────────────────────────────

  describe("detachWs", () => {
    test("sets session ws to null", () => {
      const ws = makeMockWs();
      const session = makeMockSession({ id: "d1", ws });
      sessions.set("d1", session);
      detachWs("d1");
      expect(session.ws).toBeNull();
    });

    test("does nothing for non-existent session", () => {
      // Should not throw
      detachWs("nonexistent");
    });
  });

  // ── writeToSession ───────────────────────────────────────

  describe("writeToSession", () => {
    test("returns false for non-existent session", () => {
      expect(writeToSession("nonexistent", "hello")).toBe(false);
    });

    test("returns false when session is not alive", () => {
      const session = makeMockSession({ id: "w1", alive: false });
      sessions.set("w1", session);
      expect(writeToSession("w1", "hello")).toBe(false);
    });

    test("returns false when proc is null", () => {
      const session = makeMockSession({ id: "w2", alive: true, proc: null });
      sessions.set("w2", session);
      expect(writeToSession("w2", "hello")).toBe(false);
    });

    test("calls proc.write() and returns true when alive with proc", () => {
      const writeMock = mock(() => {});
      const session = makeMockSession({
        id: "w3",
        alive: true,
        proc: { write: writeMock, resize: mock(() => {}), kill: mock(() => {}), onData: mock(() => {}), onExit: mock(() => {}) },
      });
      sessions.set("w3", session);
      expect(writeToSession("w3", "hello")).toBe(true);
      expect(writeMock).toHaveBeenCalledWith("hello");
    });

    test("returns false when proc.write() throws", () => {
      const session = makeMockSession({
        id: "w4",
        alive: true,
        proc: {
          write: () => { throw new Error("write failed"); },
          resize: mock(() => {}),
          kill: mock(() => {}),
          onData: mock(() => {}),
          onExit: mock(() => {}),
        },
      });
      sessions.set("w4", session);
      expect(writeToSession("w4", "hello")).toBe(false);
    });
  });

  // ── resizeSession ────────────────────────────────────────

  describe("resizeSession", () => {
    test("returns false for non-existent session", () => {
      expect(resizeSession("nonexistent", 80, 24)).toBe(false);
    });

    test("returns false when session is not alive", () => {
      const session = makeMockSession({ id: "r1", alive: false });
      sessions.set("r1", session);
      expect(resizeSession("r1", 120, 40)).toBe(false);
    });

    test("calls proc.resize() and returns true", () => {
      const resizeMock = mock(() => {});
      const session = makeMockSession({
        id: "r2",
        alive: true,
        proc: { write: mock(() => {}), resize: resizeMock, kill: mock(() => {}), onData: mock(() => {}), onExit: mock(() => {}) },
      });
      sessions.set("r2", session);
      expect(resizeSession("r2", 120, 40)).toBe(true);
      expect(resizeMock).toHaveBeenCalledWith(120, 40);
    });

    test("returns false when proc.resize() throws", () => {
      const session = makeMockSession({
        id: "r3",
        alive: true,
        proc: {
          write: mock(() => {}),
          resize: () => { throw new Error("resize failed"); },
          kill: mock(() => {}),
          onData: mock(() => {}),
          onExit: mock(() => {}),
        },
      });
      sessions.set("r3", session);
      expect(resizeSession("r3", 120, 40)).toBe(false);
    });
  });

  // ── resolveClaudeCmd ─────────────────────────────────────

  describe("resolveClaudeCmd", () => {
    test("returns a string", () => {
      const result = resolveClaudeCmd({ PATH: "/usr/bin" });
      expect(typeof result).toBe("string");
    });

    test("returns the first line of the which/where output on success", () => {
      // The mock returns { stdout: "/usr/bin/claude\n", exitCode: 0 }
      const result = resolveClaudeCmd({ PATH: "/usr/bin" });
      expect(result).toBe("/usr/bin/claude");
    });
  });

  // ── resolveCwd ───────────────────────────────────────────

  describe("resolveCwd", () => {
    test("returns process.cwd() when no projectId given", () => {
      const result = resolveCwd();
      expect(result).toBe(process.cwd());
    });

    test("returns process.cwd() when projectId given but DB returns no project", () => {
      // Mock returns undefined for get() by default
      const result = resolveCwd("nonexistent-project");
      expect(result).toBe(process.cwd());
    });

    test("returns project path when DB returns a project", () => {
      // Override the mock for this specific test
      const _originalGet = mockPrepare;
      mockPrepare.mockImplementationOnce(() => ({
        get: mock((..._args: any[]) => ({ path: "/home/user/my-project" })),
        all: mock((..._args: any[]) => []),
        run: mock((..._args: any[]) => {}),
      }));
      const result = resolveCwd("proj-123");
      expect(result).toBe("/home/user/my-project");
    });
  });

  // ── getBatchResolveStatus ────────────────────────────────

  describe("getBatchResolveStatus", () => {
    test("returns idle state initially", () => {
      const status = getBatchResolveStatus();
      expect(status.state).toBe("idle");
      expect(status.totalTasks).toBe(0);
      expect(status.completedTasks).toBe(0);
      expect(status.taskResults).toEqual([]);
    });

    test("returns a copy (not a reference to the internal object)", () => {
      const status1 = getBatchResolveStatus();
      const status2 = getBatchResolveStatus();
      expect(status1).not.toBe(status2);
      expect(status1.taskResults).not.toBe(status2.taskResults);
    });
  });

  // ── Scrollback buffer behavior (via emitData) ───────────

  describe("scrollback buffer", () => {
    test("starts empty", () => {
      const session = makeMockSession();
      expect(session.scrollback).toBe("");
    });

    test("accumulates data from emitData", () => {
      const session = makeMockSession();
      emitData(session, "hello ");
      emitData(session, "world");
      expect(session.scrollback).toBe("hello world");
    });

    test("is capped at MAX_SCROLLBACK_CHARS", () => {
      const session = makeMockSession();
      // Emit more than MAX_SCROLLBACK_CHARS
      const bigData = "x".repeat(MAX_SCROLLBACK_CHARS + 1000);
      emitData(session, bigData);
      expect(session.scrollback.length).toBe(MAX_SCROLLBACK_CHARS);
    });

    test("keeps the most recent data when truncating", () => {
      const session = makeMockSession();
      session.scrollback = "a".repeat(MAX_SCROLLBACK_CHARS - 3);
      emitData(session, "bcd" + "e".repeat(5));
      // Total would be (MAX-3) + 8 = MAX+5, so truncate from start
      expect(session.scrollback.length).toBe(MAX_SCROLLBACK_CHARS);
      expect(session.scrollback.endsWith("bcdeeeee")).toBe(true);
    });
  });

  // ── Integration: emitData + attachWs flush ───────────────

  describe("emitData buffering then attachWs flush", () => {
    test("data buffered before attach is flushed on attach", () => {
      const session = makeMockSession({ id: "int1" });
      sessions.set("int1", session);

      // Emit data with no WS
      emitData(session, "before-attach-1");
      emitData(session, "before-attach-2");
      expect(session.outputBuffer).toHaveLength(2);

      // Attach WS
      const ws = makeMockWs();
      attachWs("int1", ws);

      // Buffer should be flushed to WS
      ws.sent
        .map((s) => JSON.parse(s))
        .filter((m: any) => m.type === "output");
      // scrollback also sent (empty in this case since emitData appended to scrollback)
      expect(session.outputBuffer).toHaveLength(0);
    });
  });

  // ── createSession (shell) ─────────────────────────────────

  describe("createSession — shell", () => {
    test("returns a session with correct type and id in sessions map", async () => {
      const session = await createSession({ type: "shell" });
      expect(session.type).toBe("shell");
      expect(session.id).toMatch(/^term-/);
      expect(sessions.has(session.id)).toBe(true);
      expect(sessions.get(session.id)).toBe(session);
    });

    test("session is marked alive initially", async () => {
      const session = await createSession({ type: "shell" });
      expect(session.alive).toBe(true);
    });

    test("calls spawnPty with a shell executable", async () => {
      await createSession({ type: "shell" });
      expect(spawnPtyCalls.length).toBe(1);
      // On Linux, shell should be bash/zsh/sh; we just check it's a non-empty string
      expect(typeof spawnPtyCalls[0].cmd).toBe("string");
      expect(spawnPtyCalls[0].cmd.length).toBeGreaterThan(0);
    });

    test("passes cols and rows from options", async () => {
      await createSession({ type: "shell", cols: 120, rows: 40 });
      expect(spawnPtyCalls[0].opts.cols).toBe(120);
      expect(spawnPtyCalls[0].opts.rows).toBe(40);
    });

    test("defaults cols to 80 and rows to 24", async () => {
      await createSession({ type: "shell" });
      expect(spawnPtyCalls[0].opts.cols).toBe(80);
      expect(spawnPtyCalls[0].opts.rows).toBe(24);
    });

    test("stores projectId on session", async () => {
      const session = await createSession({ type: "shell", projectId: "proj-abc" });
      expect(session.projectId).toBe("proj-abc");
    });

    test("stores name on session", async () => {
      const session = await createSession({ type: "shell", name: "My Shell" });
      expect(session.name).toBe("My Shell");
    });

    test("initializes outputBuffer and scrollback as empty", async () => {
      const session = await createSession({ type: "shell" });
      expect(session.outputBuffer).toEqual([]);
      expect(session.scrollback).toBe("");
      expect(session.exitBuffer).toBeNull();
    });

    test("session proc is set after creation", async () => {
      const session = await createSession({ type: "shell" });
      expect(session.proc).not.toBeNull();
    });
  });

  // ── createSession (dev) ──────────────────────────────────

  describe("createSession — dev", () => {
    test("creates a session with type 'dev'", async () => {
      const session = await createSession({ type: "dev" });
      expect(session.type).toBe("dev");
      expect(sessions.has(session.id)).toBe(true);
    });

    test("spawns a shell PTY (same as shell session)", async () => {
      await createSession({ type: "dev" });
      expect(spawnPtyCalls.length).toBe(1);
    });

    test("writes safe dev command to proc after creation", async () => {
      const session = await createSession({ type: "dev", devCommand: "bun run dev" });
      // The mock proc should have had write() called with the command
      expect(session.proc).not.toBeNull();
      const proc = session.proc as any;
      expect(proc.write).toHaveBeenCalledWith("bun run dev\r\n");
    });

    test("does NOT write unsafe dev command to proc", async () => {
      const session = await createSession({ type: "dev", devCommand: "rm -rf /" });
      const proc = session.proc as any;
      // write should not have been called with the unsafe command
      // (it may have been called 0 times total since only safe commands are written)
      const writeCalls = proc.write.mock.calls;
      const hasUnsafe = writeCalls.some((c: any[]) => c[0] === "rm -rf /\r\n");
      expect(hasUnsafe).toBe(false);
    });

    test("writes 'npm run dev' as a safe dev command", async () => {
      const session = await createSession({ type: "dev", devCommand: "npm run dev" });
      const proc = session.proc as any;
      expect(proc.write).toHaveBeenCalledWith("npm run dev\r\n");
    });
  });

  // ── createSession (claude-ai) ────────────────────────────

  describe("createSession — claude-ai", () => {
    test("creates a session with type 'claude-ai' and shell PTY", async () => {
      const session = await createSession({ type: "claude-ai" });
      expect(session.type).toBe("claude-ai");
      expect(sessions.has(session.id)).toBe(true);
      // claude-ai type goes through the shell path (not ai-resolve)
      expect(spawnPtyCalls.length).toBe(1);
    });
  });

  // ── createSession (ai-resolve) ───────────────────────────

  describe("createSession — ai-resolve", () => {
    test("creates a session with type 'ai-resolve'", async () => {
      const session = await createSession({ type: "ai-resolve", prompt: "Fix the bug" });
      expect(session.type).toBe("ai-resolve");
      expect(sessions.has(session.id)).toBe(true);
    });

    test("calls spawnPty with claude command and prompt as argument", async () => {
      await createSession({ type: "ai-resolve", prompt: "Fix the bug" });
      expect(spawnPtyCalls.length).toBe(1);
      // The args should include --dangerously-skip-permissions and the prompt
      expect(spawnPtyCalls[0].args).toContain("--dangerously-skip-permissions");
      expect(spawnPtyCalls[0].args).toContain("Fix the bug");
    });

    test("stores taskId and projectId on session", async () => {
      const session = await createSession({
        type: "ai-resolve",
        prompt: "Fix it",
        taskId: "task-1",
        projectId: "proj-1",
      });
      expect(session.taskId).toBe("task-1");
      expect(session.projectId).toBe("proj-1");
    });

    test("session proc is set after creation", async () => {
      const session = await createSession({ type: "ai-resolve", prompt: "Fix the bug" });
      expect(session.proc).not.toBeNull();
    });
  });

  // ── createSession (ai-test) ──────────────────────────────

  describe("createSession — ai-test", () => {
    test("creates a session with type 'ai-test'", async () => {
      const session = await createSession({ type: "ai-test", prompt: "Run tests" });
      expect(session.type).toBe("ai-test");
      expect(sessions.has(session.id)).toBe(true);
    });

    test("calls spawnPty with claude command and prompt", async () => {
      await createSession({ type: "ai-test", prompt: "Run tests" });
      expect(spawnPtyCalls.length).toBe(1);
      expect(spawnPtyCalls[0].args).toContain("--dangerously-skip-permissions");
      expect(spawnPtyCalls[0].args).toContain("Run tests");
    });

    test("session proc is set", async () => {
      const session = await createSession({ type: "ai-test", prompt: "Run tests" });
      expect(session.proc).not.toBeNull();
    });
  });

  // ── PTY onData/onExit callbacks ──────────────────────────

  describe("PTY callbacks wired through createSession", () => {
    test("onData callback routes data through emitData to outputBuffer", async () => {
      const session = await createSession({ type: "shell" });
      // The mock PTY's onData callback was captured
      expect(latestPtyOnData).not.toBeNull();
      // Simulate PTY output
      latestPtyOnData!("hello from pty");
      // Since no WS is attached, data goes to outputBuffer
      expect(session.outputBuffer).toContain("hello from pty");
      expect(session.scrollback).toContain("hello from pty");
    });

    test("onExit callback marks session as not alive", async () => {
      const session = await createSession({ type: "shell" });
      expect(latestPtyOnExit).not.toBeNull();
      expect(session.alive).toBe(true);
      // Simulate PTY exit
      latestPtyOnExit!(0);
      expect(session.alive).toBe(false);
    });

    test("onExit callback sets proc to null for shell sessions", async () => {
      const session = await createSession({ type: "shell" });
      expect(session.proc).not.toBeNull();
      latestPtyOnExit!(0);
      expect(session.proc).toBeNull();
    });

    test("onExit buffers exit code when no WS attached", async () => {
      const session = await createSession({ type: "shell" });
      latestPtyOnExit!(42);
      expect(session.exitBuffer).toBe(42);
    });

    test("ai-resolve onExit removes session from map", async () => {
      const session = await createSession({ type: "ai-resolve", prompt: "Fix it" });
      const id = session.id;
      expect(sessions.has(id)).toBe(true);
      latestPtyOnExit!(0);
      expect(sessions.has(id)).toBe(false);
    });

    test("ai-test onExit removes session from map", async () => {
      const session = await createSession({ type: "ai-test", prompt: "Test it" });
      const id = session.id;
      expect(sessions.has(id)).toBe(true);
      latestPtyOnExit!(0);
      expect(sessions.has(id)).toBe(false);
    });
  });

  // ── Edge cases ───────────────────────────────────────────

  describe("edge cases", () => {
    test("killSession handles null proc gracefully", () => {
      const session = makeMockSession({ id: "e1", proc: null });
      sessions.set("e1", session);
      expect(killSession("e1")).toBe(true);
    });

    test("killSession handles null ws gracefully", () => {
      const session = makeMockSession({ id: "e2", ws: null });
      sessions.set("e2", session);
      expect(killSession("e2")).toBe(true);
    });

    test("emitData handles empty string", () => {
      const ws = makeMockWs();
      const session = makeMockSession({ ws });
      emitData(session, "");
      // Empty string is still sent
      expect(ws.sent).toHaveLength(1);
      expect(JSON.parse(ws.sent[0]).data).toBe("");
    });

    test("emitExit handles exit code 0", () => {
      const ws = makeMockWs();
      const session = makeMockSession({ ws });
      emitExit(session, 0);
      expect(JSON.parse(ws.sent[0]).exitCode).toBe(0);
    });

    test("emitExit handles negative exit code", () => {
      const ws = makeMockWs();
      const session = makeMockSession({ ws });
      emitExit(session, -1);
      expect(JSON.parse(ws.sent[0]).exitCode).toBe(-1);
    });
  });
});
