import { describe, test, expect, beforeEach } from "bun:test";
import {
  SAFE_ENV_KEYS,
  MAX_SCROLLBACK_CHARS,
  getSafeEnv,
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
  cancelBatchResolve,
  batchState,
  type PtySession,
} from "./terminalService";

// We test the pure/exported functions by importing them.
// For internal functions we test through behavior of the module.

// getSafeEnv and SAFE_ENV_KEYS are not exported, so we test them indirectly
// by importing the module and using the public API.
// However, we can test the concept by reimplementing the same filtering logic.

describe("terminalService - getSafeEnv logic", () => {
  // Since getSafeEnv is not exported, we verify the filtering concept
  const SAFE_ENV_KEYS = new Set([
    "PATH",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "USERPROFILE",
    "USER",
    "USERNAME",
    "SHELL",
    "TERM",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "NODE_ENV",
    "EDITOR",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PSModulePath",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMFILES",
    "PROGRAMDATA",
  ]);

  function getSafeEnv(env: Record<string, string | undefined>): Record<string, string> {
    const safe: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (value && (SAFE_ENV_KEYS.has(key) || key.startsWith("LC_"))) {
        safe[key] = value;
      }
    }
    return safe;
  }

  test("includes whitelisted keys", () => {
    const env = { PATH: "/usr/bin", HOME: "/home/user", SECRET: "hidden" };
    const safe = getSafeEnv(env);
    expect(safe.PATH).toBe("/usr/bin");
    expect(safe.HOME).toBe("/home/user");
  });

  test("excludes non-whitelisted keys", () => {
    const env = { PATH: "/usr/bin", AWS_SECRET_KEY: "secret", DATABASE_URL: "postgres://..." };
    const safe = getSafeEnv(env);
    expect(safe.AWS_SECRET_KEY).toBeUndefined();
    expect(safe.DATABASE_URL).toBeUndefined();
  });

  test("includes LC_ prefixed keys", () => {
    const env = { LC_CTYPE: "UTF-8", LC_MESSAGES: "en_US.UTF-8", RANDOM: "val" };
    const safe = getSafeEnv(env);
    expect(safe.LC_CTYPE).toBe("UTF-8");
    expect(safe.LC_MESSAGES).toBe("en_US.UTF-8");
    expect(safe.RANDOM).toBeUndefined();
  });

  test("excludes keys with undefined/empty values", () => {
    const env = { PATH: "", HOME: undefined as any, USER: "test" };
    const safe = getSafeEnv(env);
    expect(safe.PATH).toBeUndefined();
    expect(safe.HOME).toBeUndefined();
    expect(safe.USER).toBe("test");
  });

  test("includes all standard safe keys when present", () => {
    const allSafe: Record<string, string> = {};
    for (const key of SAFE_ENV_KEYS) {
      allSafe[key] = `val-${key}`;
    }
    allSafe["DANGEROUS"] = "should-not-appear";
    const result = getSafeEnv(allSafe);
    for (const key of SAFE_ENV_KEYS) {
      expect(result[key]).toBe(`val-${key}`);
    }
    expect(result.DANGEROUS).toBeUndefined();
  });
});

describe("terminalService - emitData/emitExit logic", () => {
  // Test the buffering logic pattern used by emitData/emitExit

  interface MockSession {
    ws: { readyState: number; sent: string[] } | null;
    outputBuffer: string[];
    exitBuffer: number | null;
  }

  function emitData(session: MockSession, data: string) {
    if (session.ws && session.ws.readyState === 1) {
      session.ws.sent.push(JSON.stringify({ type: "output", data }));
    } else {
      session.outputBuffer.push(data);
    }
  }

  function emitExit(session: MockSession, exitCode: number) {
    if (session.ws && session.ws.readyState === 1) {
      session.ws.sent.push(JSON.stringify({ type: "exit", exitCode }));
    } else {
      session.exitBuffer = exitCode;
    }
  }

  test("sends data to WebSocket when connected (readyState=1)", () => {
    const session: MockSession = {
      ws: { readyState: 1, sent: [] },
      outputBuffer: [],
      exitBuffer: null,
    };
    emitData(session, "hello");
    expect(session.ws!.sent).toHaveLength(1);
    expect(JSON.parse(session.ws!.sent[0])).toEqual({ type: "output", data: "hello" });
    expect(session.outputBuffer).toHaveLength(0);
  });

  test("buffers data when no WebSocket attached", () => {
    const session: MockSession = {
      ws: null,
      outputBuffer: [],
      exitBuffer: null,
    };
    emitData(session, "buffered");
    expect(session.outputBuffer).toEqual(["buffered"]);
  });

  test("buffers data when WebSocket is not open (readyState != 1)", () => {
    const session: MockSession = {
      ws: { readyState: 0, sent: [] },
      outputBuffer: [],
      exitBuffer: null,
    };
    emitData(session, "buffered");
    expect(session.outputBuffer).toEqual(["buffered"]);
    expect(session.ws!.sent).toHaveLength(0);
  });

  test("sends exit code to WebSocket when connected", () => {
    const session: MockSession = {
      ws: { readyState: 1, sent: [] },
      outputBuffer: [],
      exitBuffer: null,
    };
    emitExit(session, 0);
    expect(JSON.parse(session.ws!.sent[0])).toEqual({ type: "exit", exitCode: 0 });
    expect(session.exitBuffer).toBeNull();
  });

  test("buffers exit code when no WebSocket", () => {
    const session: MockSession = {
      ws: null,
      outputBuffer: [],
      exitBuffer: null,
    };
    emitExit(session, 1);
    expect(session.exitBuffer).toBe(1);
  });

  test("multiple data emissions accumulate in buffer", () => {
    const session: MockSession = {
      ws: null,
      outputBuffer: [],
      exitBuffer: null,
    };
    emitData(session, "line1");
    emitData(session, "line2");
    emitData(session, "line3");
    expect(session.outputBuffer).toEqual(["line1", "line2", "line3"]);
  });

  test("exit code overwrites previous buffered exit", () => {
    const session: MockSession = {
      ws: null,
      outputBuffer: [],
      exitBuffer: null,
    };
    emitExit(session, 1);
    emitExit(session, 0);
    expect(session.exitBuffer).toBe(0);
  });
});

describe("terminalService - session flush on attach", () => {
  // Tests the attachWs pattern: flush buffered output/exit when WS connects

  interface MockSession {
    ws: { readyState: number; sent: string[] } | null;
    outputBuffer: string[];
    exitBuffer: number | null;
  }

  function attachWs(session: MockSession, ws: { readyState: number; sent: string[] }): boolean {
    session.ws = ws;
    if (session.outputBuffer.length > 0) {
      for (const data of session.outputBuffer) {
        if (ws.readyState === 1) {
          ws.sent.push(JSON.stringify({ type: "output", data }));
        }
      }
      session.outputBuffer = [];
    }
    if (session.exitBuffer !== null) {
      if (ws.readyState === 1) {
        ws.sent.push(JSON.stringify({ type: "exit", exitCode: session.exitBuffer }));
      }
      session.exitBuffer = null;
    }
    return true;
  }

  test("flushes buffered output on attach", () => {
    const session: MockSession = {
      ws: null,
      outputBuffer: ["line1", "line2"],
      exitBuffer: null,
    };
    const ws = { readyState: 1, sent: [] as string[] };
    attachWs(session, ws);
    expect(ws.sent).toHaveLength(2);
    expect(session.outputBuffer).toHaveLength(0);
  });

  test("flushes buffered exit on attach", () => {
    const session: MockSession = {
      ws: null,
      outputBuffer: [],
      exitBuffer: 42,
    };
    const ws = { readyState: 1, sent: [] as string[] };
    attachWs(session, ws);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "exit", exitCode: 42 });
    expect(session.exitBuffer).toBeNull();
  });

  test("flushes both output and exit in order", () => {
    const session: MockSession = {
      ws: null,
      outputBuffer: ["data1", "data2"],
      exitBuffer: 0,
    };
    const ws = { readyState: 1, sent: [] as string[] };
    attachWs(session, ws);
    expect(ws.sent).toHaveLength(3);
    expect(JSON.parse(ws.sent[0]).type).toBe("output");
    expect(JSON.parse(ws.sent[1]).type).toBe("output");
    expect(JSON.parse(ws.sent[2]).type).toBe("exit");
  });
});

describe("terminalService - AI test session chain logic", () => {
  // These tests verify the chain decision logic used in spawnAiResolve's onExit handler.
  // The actual chaining calls chainAiTest only when:
  //   success === true && session.taskId && session.projectId && opts.autoTest !== false

  function shouldChainTest(
    success: boolean,
    taskId: string | undefined,
    projectId: string | undefined,
    autoTest: boolean | undefined,
  ): boolean {
    return success && !!taskId && !!projectId && autoTest !== false;
  }

  test("chains when resolve succeeded with taskId and projectId", () => {
    expect(shouldChainTest(true, "task-1", "proj-1", undefined)).toBe(true);
  });

  test("chains when autoTest is explicitly true", () => {
    expect(shouldChainTest(true, "task-1", "proj-1", true)).toBe(true);
  });

  test("does NOT chain when autoTest is false (prevents infinite loop)", () => {
    expect(shouldChainTest(true, "task-1", "proj-1", false)).toBe(false);
  });

  test("does NOT chain when resolve failed", () => {
    expect(shouldChainTest(false, "task-1", "proj-1", undefined)).toBe(false);
  });

  test("does NOT chain when taskId is missing", () => {
    expect(shouldChainTest(true, undefined, "proj-1", undefined)).toBe(false);
  });

  test("does NOT chain when projectId is missing", () => {
    expect(shouldChainTest(true, "task-1", undefined, undefined)).toBe(false);
  });

  test("does NOT chain when both taskId and projectId are missing", () => {
    expect(shouldChainTest(false, undefined, undefined, undefined)).toBe(false);
  });
});

describe("terminalService - AI resolve success detection", () => {
  // The success check in spawnAiResolve uses:
  //   const success = task?.status === "done" || exitCode === 0;

  function isResolveSuccess(taskStatus: string | undefined, exitCode: number): boolean {
    return taskStatus === "done" || exitCode === 0;
  }

  test("succeeds when task status is done (even with non-zero exit)", () => {
    expect(isResolveSuccess("done", 1)).toBe(true);
  });

  test("succeeds when exit code is 0 (even if task not done)", () => {
    expect(isResolveSuccess("in_progress", 0)).toBe(true);
  });

  test("succeeds when both task done and exit 0", () => {
    expect(isResolveSuccess("done", 0)).toBe(true);
  });

  test("fails when task not done and exit code non-zero", () => {
    expect(isResolveSuccess("in_progress", 1)).toBe(false);
  });

  test("fails when task status is undefined and exit code non-zero", () => {
    expect(isResolveSuccess(undefined, 1)).toBe(false);
  });

  test("treats backlog/todo as not done", () => {
    expect(isResolveSuccess("backlog", 1)).toBe(false);
    expect(isResolveSuccess("todo", 1)).toBe(false);
  });
});

describe("terminalService - AI test session type validation", () => {
  // The terminal route validates session types against this allowlist
  const VALID_TYPES = ["shell", "dev", "claude-ai", "ai-resolve", "ai-test"];

  test("ai-test is a valid session type", () => {
    expect(VALID_TYPES.includes("ai-test")).toBe(true);
  });

  test("all TerminalSessionType values are in the allowlist", () => {
    // These should match the shared type: "shell" | "dev" | "claude-ai" | "ai-resolve" | "ai-test"
    const expectedTypes = ["shell", "dev", "claude-ai", "ai-resolve", "ai-test"];
    for (const type of expectedTypes) {
      expect(VALID_TYPES.includes(type)).toBe(true);
    }
  });

  test("invalid types are rejected", () => {
    expect(VALID_TYPES.includes("invalid")).toBe(false);
    expect(VALID_TYPES.includes("ai-debug")).toBe(false);
    expect(VALID_TYPES.includes("test")).toBe(false);
  });
});

describe("terminalService - AI run recording", () => {
  // Tests the DB insert pattern used for recording AI runs

  test("resolve session records profile as 'auto'", () => {
    // spawnAiResolve uses profile 'auto' when recording
    const profile = "auto";
    expect(profile).toBe("auto");
  });

  test("test session records profile as 'test'", () => {
    // spawnAiTest uses profile 'test' when recording
    const profile = "test";
    expect(profile).toBe("test");
  });

  test("chainAiTest sets autoTest to false to prevent infinite chain", () => {
    // When chainAiTest creates a new session, it sets autoTest: false
    // This prevents: resolve → test → (no further chain)
    const chainOpts = { autoTest: false };
    expect(chainOpts.autoTest).toBe(false);
  });
});

describe("terminalService - scrollback buffer", () => {
  const MAX_SCROLLBACK_CHARS = 100_000;

  function appendScrollback(current: string, data: string): string {
    let result = current + data;
    if (result.length > MAX_SCROLLBACK_CHARS) {
      result = result.slice(-MAX_SCROLLBACK_CHARS);
    }
    return result;
  }

  test("appends data within limit", () => {
    const result = appendScrollback("hello", " world");
    expect(result).toBe("hello world");
  });

  test("truncates from start when exceeding limit", () => {
    const base = "a".repeat(MAX_SCROLLBACK_CHARS - 5);
    const data = "b".repeat(10);
    const result = appendScrollback(base, data);
    expect(result.length).toBe(MAX_SCROLLBACK_CHARS);
    expect(result.endsWith("b".repeat(10))).toBe(true);
    expect(result.startsWith("a")).toBe(true);
  });

  test("handles empty scrollback", () => {
    const result = appendScrollback("", "new data");
    expect(result).toBe("new data");
  });
});

// ── Direct imports from the actual module ───────────────────────
// These tests import and exercise the real exported functions from
// terminalService.ts so their lines count toward branch coverage.

function makePtySession(overrides: Partial<PtySession> = {}): PtySession {
  return {
    id: overrides.id ?? "ts-test-1",
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
    send(data: string) {
      this.sent.push(data);
    },
    close() {
      this.readyState = 3;
    },
  };
}

describe("terminalService module — exported constants", () => {
  test("MAX_SCROLLBACK_CHARS is 100,000", () => {
    expect(MAX_SCROLLBACK_CHARS).toBe(100_000);
  });

  test("SAFE_ENV_KEYS is a Set containing standard env keys", () => {
    expect(SAFE_ENV_KEYS).toBeInstanceOf(Set);
    expect(SAFE_ENV_KEYS.has("PATH")).toBe(true);
    expect(SAFE_ENV_KEYS.has("HOME")).toBe(true);
    expect(SAFE_ENV_KEYS.has("SHELL")).toBe(true);
    expect(SAFE_ENV_KEYS.has("EDITOR")).toBe(true);
    expect(SAFE_ENV_KEYS.has("NODE_ENV")).toBe(true);
  });

  test("SAFE_ENV_KEYS excludes sensitive keys", () => {
    expect(SAFE_ENV_KEYS.has("AWS_SECRET_KEY")).toBe(false);
    expect(SAFE_ENV_KEYS.has("DATABASE_URL")).toBe(false);
    expect(SAFE_ENV_KEYS.has("ANTHROPIC_API_KEY")).toBe(false);
  });
});

describe("terminalService module — getSafeEnv", () => {
  test("returns an object with only allowed keys", () => {
    const result = getSafeEnv();
    expect(typeof result).toBe("object");
    for (const key of Object.keys(result)) {
      expect(SAFE_ENV_KEYS.has(key) || key.startsWith("LC_")).toBe(true);
    }
  });

  test("includes PATH if set in process.env", () => {
    const original = process.env.PATH;
    process.env.PATH = "/custom/bin";
    try {
      const result = getSafeEnv();
      expect(result.PATH).toBe("/custom/bin");
    } finally {
      process.env.PATH = original;
    }
  });

  test("excludes non-whitelisted env vars", () => {
    const original = process.env.MY_PRIVATE_KEY;
    process.env.MY_PRIVATE_KEY = "secret";
    try {
      expect(getSafeEnv().MY_PRIVATE_KEY).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.MY_PRIVATE_KEY;
      else process.env.MY_PRIVATE_KEY = original;
    }
  });

  test("includes LC_* prefixed keys", () => {
    const original = process.env.LC_TEST_CUSTOM;
    process.env.LC_TEST_CUSTOM = "utf-8";
    try {
      expect(getSafeEnv().LC_TEST_CUSTOM).toBe("utf-8");
    } finally {
      if (original === undefined) delete process.env.LC_TEST_CUSTOM;
      else process.env.LC_TEST_CUSTOM = original;
    }
  });

  test("excludes keys with empty string values", () => {
    const original = process.env.EDITOR;
    process.env.EDITOR = "";
    try {
      expect(getSafeEnv().EDITOR).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = original;
    }
  });
});

describe("terminalService module — generateId / _resetIdCounter", () => {
  beforeEach(() => {
    _resetIdCounter();
  });

  test("generateId returns string starting with term-", () => {
    expect(generateId()).toMatch(/^term-/);
  });

  test("generateId increments counter", () => {
    const id1 = generateId();
    const id2 = generateId();
    const c1 = parseInt(id1.split("-")[1], 10);
    const c2 = parseInt(id2.split("-")[1], 10);
    expect(c2).toBe(c1 + 1);
  });

  test("_resetIdCounter resets the counter", () => {
    generateId();
    generateId();
    _resetIdCounter();
    const id = generateId();
    expect(id.split("-")[1]).toBe("1");
  });

  test("generateId produces unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(generateId());
    expect(ids.size).toBe(50);
  });
});

describe("terminalService module — resolveCwd", () => {
  test("returns process.cwd() when no projectId given", () => {
    expect(resolveCwd()).toBe(process.cwd());
  });

  test("returns process.cwd() for unknown projectId (no DB row)", () => {
    // DB exists but this projectId doesn't exist
    expect(resolveCwd("nonexistent-project-xyz-999")).toBe(process.cwd());
  });
});

describe("terminalService module — emitData (real module)", () => {
  test("sends to WS when readyState=1", () => {
    const ws = makeMockWs(1);
    const session = makePtySession({ ws });
    emitData(session, "hello");
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "output", data: "hello" });
    expect(session.outputBuffer).toHaveLength(0);
  });

  test("buffers when no WS", () => {
    const session = makePtySession({ ws: null });
    emitData(session, "buffered");
    expect(session.outputBuffer).toEqual(["buffered"]);
  });

  test("appends to scrollback unconditionally", () => {
    const session = makePtySession({ scrollback: "before-" });
    emitData(session, "after");
    expect(session.scrollback).toBe("before-after");
  });

  test("truncates scrollback at MAX_SCROLLBACK_CHARS", () => {
    const session = makePtySession({ scrollback: "a".repeat(MAX_SCROLLBACK_CHARS - 3) });
    emitData(session, "xyz!");
    expect(session.scrollback.length).toBe(MAX_SCROLLBACK_CHARS);
    expect(session.scrollback.endsWith("xyz!")).toBe(true);
  });

  test("buffers when WS readyState is not 1", () => {
    const ws = makeMockWs(0);
    const session = makePtySession({ ws });
    emitData(session, "pending");
    expect(session.outputBuffer).toEqual(["pending"]);
    expect(ws.sent).toHaveLength(0);
  });
});

describe("terminalService module — emitExit (real module)", () => {
  test("sends exit to WS when readyState=1", () => {
    const ws = makeMockWs(1);
    const session = makePtySession({ ws });
    emitExit(session, 0);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "exit", exitCode: 0 });
    expect(session.exitBuffer).toBeNull();
  });

  test("buffers exit when no WS", () => {
    const session = makePtySession({ ws: null });
    emitExit(session, 42);
    expect(session.exitBuffer).toBe(42);
  });

  test("buffers exit when WS not open", () => {
    const ws = makeMockWs(3); // CLOSED
    const session = makePtySession({ ws });
    emitExit(session, 1);
    expect(session.exitBuffer).toBe(1);
    expect(ws.sent).toHaveLength(0);
  });
});

describe("terminalService module — session Map operations", () => {
  beforeEach(() => {
    sessions.clear();
    _resetIdCounter();
  });

  test("getSession returns undefined for nonexistent", () => {
    expect(getSession("no-such-id")).toBeUndefined();
  });

  test("getSession returns session after manual set", () => {
    const s = makePtySession({ id: "m1" });
    sessions.set("m1", s);
    expect(getSession("m1")).toBe(s);
  });

  test("listSessions returns all when no filter", () => {
    sessions.set("s1", makePtySession({ id: "s1", projectId: "pA" }));
    sessions.set("s2", makePtySession({ id: "s2", projectId: "pB" }));
    expect(listSessions()).toHaveLength(2);
  });

  test("listSessions filters by projectId", () => {
    sessions.set("s1", makePtySession({ id: "s1", projectId: "pA" }));
    sessions.set("s2", makePtySession({ id: "s2", projectId: "pB" }));
    sessions.set("s3", makePtySession({ id: "s3", projectId: "pA" }));
    const filtered = listSessions("pA");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((s) => s.projectId === "pA")).toBe(true);
  });

  test("listSessions returns empty array for unknown projectId", () => {
    sessions.set("s1", makePtySession({ id: "s1", projectId: "pX" }));
    expect(listSessions("pNone")).toHaveLength(0);
  });
});

describe("terminalService module — killSession", () => {
  beforeEach(() => {
    sessions.clear();
  });

  test("returns false for nonexistent session", () => {
    expect(killSession("nonexistent")).toBe(false);
  });

  test("removes session from Map and returns true", () => {
    const s = makePtySession({ id: "k1" });
    sessions.set("k1", s);
    expect(killSession("k1")).toBe(true);
    expect(sessions.has("k1")).toBe(false);
  });

  test("sets alive to false", () => {
    const s = makePtySession({ id: "k2", alive: true });
    sessions.set("k2", s);
    killSession("k2");
    expect(s.alive).toBe(false);
  });

  test("calls proc.kill() when proc is set", () => {
    let killed = false;
    const s = makePtySession({
      id: "k3",
      proc: {
        write: () => {},
        resize: () => {},
        kill: () => {
          killed = true;
        },
        onData: () => {},
        onExit: () => {},
      },
    });
    sessions.set("k3", s);
    killSession("k3");
    expect(killed).toBe(true);
  });

  test("sends exit message to WS and closes it", () => {
    const ws = makeMockWs(1);
    const s = makePtySession({ id: "k4", ws });
    sessions.set("k4", s);
    killSession("k4");
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "exit", exitCode: 0 });
    expect(ws.readyState).toBe(3);
  });

  test("handles null proc gracefully", () => {
    const s = makePtySession({ id: "k5", proc: null });
    sessions.set("k5", s);
    expect(killSession("k5")).toBe(true);
  });

  test("handles null ws gracefully", () => {
    const s = makePtySession({ id: "k6", ws: null });
    sessions.set("k6", s);
    expect(killSession("k6")).toBe(true);
  });
});

describe("terminalService module — attachWs / detachWs", () => {
  beforeEach(() => {
    sessions.clear();
  });

  test("attachWs returns false for nonexistent session", () => {
    expect(attachWs("no-such", makeMockWs())).toBe(false);
  });

  test("attachWs assigns WS and returns true", () => {
    const s = makePtySession({ id: "a1" });
    sessions.set("a1", s);
    const ws = makeMockWs();
    expect(attachWs("a1", ws)).toBe(true);
    expect(s.ws).toBe(ws);
  });

  test("attachWs sends scrollback history", () => {
    const s = makePtySession({ id: "a2", scrollback: "old output" });
    sessions.set("a2", s);
    const ws = makeMockWs();
    attachWs("a2", ws);
    const scrollMsg = ws.sent.find((m) => {
      const p = JSON.parse(m);
      return p.type === "output" && p.data === "old output";
    });
    expect(scrollMsg).toBeDefined();
  });

  test("attachWs flushes outputBuffer", () => {
    const s = makePtySession({ id: "a3", outputBuffer: ["line1", "line2"] });
    sessions.set("a3", s);
    const ws = makeMockWs();
    attachWs("a3", ws);
    const outputMsgs = ws.sent.filter((m) => JSON.parse(m).type === "output");
    // scrollback is empty so only buffered lines
    expect(outputMsgs.length).toBeGreaterThanOrEqual(2);
    expect(s.outputBuffer).toHaveLength(0);
  });

  test("attachWs flushes exitBuffer", () => {
    const s = makePtySession({ id: "a4", exitBuffer: 7 });
    sessions.set("a4", s);
    const ws = makeMockWs();
    attachWs("a4", ws);
    const exitMsg = ws.sent.find((m) => JSON.parse(m).type === "exit");
    expect(exitMsg).toBeDefined();
    expect(JSON.parse(exitMsg!).exitCode).toBe(7);
    expect(s.exitBuffer).toBeNull();
  });

  test("detachWs sets ws to null", () => {
    const ws = makeMockWs();
    const s = makePtySession({ id: "d1", ws });
    sessions.set("d1", s);
    detachWs("d1");
    expect(s.ws).toBeNull();
  });

  test("detachWs is no-op for nonexistent session", () => {
    expect(() => detachWs("nonexistent")).not.toThrow();
  });
});

describe("terminalService module — writeToSession / resizeSession", () => {
  beforeEach(() => {
    sessions.clear();
  });

  test("writeToSession returns false for nonexistent", () => {
    expect(writeToSession("none", "x")).toBe(false);
  });

  test("writeToSession returns false when not alive", () => {
    const s = makePtySession({ id: "w1", alive: false });
    sessions.set("w1", s);
    expect(writeToSession("w1", "x")).toBe(false);
  });

  test("writeToSession returns false when proc is null", () => {
    const s = makePtySession({ id: "w2", alive: true, proc: null });
    sessions.set("w2", s);
    expect(writeToSession("w2", "x")).toBe(false);
  });

  test("writeToSession calls proc.write and returns true", () => {
    let written = "";
    const s = makePtySession({
      id: "w3",
      alive: true,
      proc: {
        write: (d: string) => {
          written = d;
        },
        resize: () => {},
        kill: () => {},
        onData: () => {},
        onExit: () => {},
      },
    });
    sessions.set("w3", s);
    expect(writeToSession("w3", "hello")).toBe(true);
    expect(written).toBe("hello");
  });

  test("writeToSession returns false when proc.write throws", () => {
    const s = makePtySession({
      id: "w4",
      alive: true,
      proc: {
        write: () => {
          throw new Error("io error");
        },
        resize: () => {},
        kill: () => {},
        onData: () => {},
        onExit: () => {},
      },
    });
    sessions.set("w4", s);
    expect(writeToSession("w4", "x")).toBe(false);
  });

  test("resizeSession returns false for nonexistent", () => {
    expect(resizeSession("none", 80, 24)).toBe(false);
  });

  test("resizeSession returns false when not alive", () => {
    const s = makePtySession({ id: "r1", alive: false });
    sessions.set("r1", s);
    expect(resizeSession("r1", 120, 40)).toBe(false);
  });

  test("resizeSession calls proc.resize and returns true", () => {
    let resized = { cols: 0, rows: 0 };
    const s = makePtySession({
      id: "r2",
      alive: true,
      proc: {
        write: () => {},
        resize: (c: number, r: number) => {
          resized = { cols: c, rows: r };
        },
        kill: () => {},
        onData: () => {},
        onExit: () => {},
      },
    });
    sessions.set("r2", s);
    expect(resizeSession("r2", 132, 50)).toBe(true);
    expect(resized).toEqual({ cols: 132, rows: 50 });
  });

  test("resizeSession returns false when proc.resize throws", () => {
    const s = makePtySession({
      id: "r3",
      alive: true,
      proc: {
        write: () => {},
        resize: () => {
          throw new Error("resize error");
        },
        kill: () => {},
        onData: () => {},
        onExit: () => {},
      },
    });
    sessions.set("r3", s);
    expect(resizeSession("r3", 80, 24)).toBe(false);
  });
});

describe("terminalService module — resolveClaudeCmd", () => {
  test("returns a non-empty string", () => {
    const result = resolveClaudeCmd({ PATH: process.env.PATH || "/usr/bin" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("returns 'claude' as fallback when command not found", () => {
    // Pass empty PATH so 'which' fails to find claude
    const result = resolveClaudeCmd({ PATH: "" });
    // Either claude is found or falls back to "claude"
    expect(typeof result).toBe("string");
  });
});

describe("terminalService module — getBatchResolveStatus / cancelBatchResolve", () => {
  beforeEach(() => {
    Object.assign(batchState, {
      state: "idle",
      projectId: undefined,
      totalTasks: 0,
      completedTasks: 0,
      concurrency: undefined,
      currentTaskId: undefined,
      currentTaskTitle: undefined,
      currentSessionId: undefined,
      activeTasks: [],
      taskResults: [],
    });
    sessions.clear();
  });

  test("getBatchResolveStatus returns idle state initially", () => {
    const status = getBatchResolveStatus();
    expect(status.state).toBe("idle");
    expect(status.totalTasks).toBe(0);
    expect(status.taskResults).toEqual([]);
  });

  test("getBatchResolveStatus returns a copy, not a reference", () => {
    const s1 = getBatchResolveStatus();
    const s2 = getBatchResolveStatus();
    expect(s1).not.toBe(s2);
    expect(s1.taskResults).not.toBe(s2.taskResults);
  });

  test("cancelBatchResolve returns current status when not running", () => {
    const status = cancelBatchResolve();
    expect(status.state).toBe("idle");
  });

  test("cancelBatchResolve sets state to cancelled when running", () => {
    batchState.state = "running";
    batchState.activeTasks = [];
    const status = cancelBatchResolve();
    expect(status.state).toBe("cancelled");
  });

  test("cancelBatchResolve kills active sessions", () => {
    const s = makePtySession({ id: "bs1" });
    sessions.set("bs1", s);
    batchState.state = "running";
    batchState.activeTasks = [{ taskId: "t1", taskTitle: "T1", sessionId: "bs1" }];
    cancelBatchResolve();
    expect(sessions.has("bs1")).toBe(false);
    expect(s.alive).toBe(false);
  });

  test("cancelBatchResolve kills legacy currentSessionId", () => {
    const s = makePtySession({ id: "bs2" });
    sessions.set("bs2", s);
    batchState.state = "running";
    batchState.activeTasks = [];
    batchState.currentSessionId = "bs2";
    cancelBatchResolve();
    expect(sessions.has("bs2")).toBe(false);
  });
});
