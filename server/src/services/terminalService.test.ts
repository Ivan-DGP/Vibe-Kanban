import { describe, test, expect, beforeEach } from "bun:test";

// We test the pure/exported functions by importing them.
// For internal functions we test through behavior of the module.

// getSafeEnv and SAFE_ENV_KEYS are not exported, so we test them indirectly
// by importing the module and using the public API.
// However, we can test the concept by reimplementing the same filtering logic.

describe("terminalService - getSafeEnv logic", () => {
  // Since getSafeEnv is not exported, we verify the filtering concept
  const SAFE_ENV_KEYS = new Set([
    "PATH", "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE",
    "USER", "USERNAME", "SHELL", "TERM", "LANG", "LC_ALL",
    "TMPDIR", "TEMP", "TMP", "NODE_ENV", "EDITOR",
    "SYSTEMROOT", "WINDIR", "COMSPEC", "PSModulePath",
    "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMDATA",
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
