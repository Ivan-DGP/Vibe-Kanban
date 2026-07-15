import { describe, test, expect, beforeEach } from "bun:test";
// Scaffolded ahead of the terminalService god-file split (P3.9): pins the
// session-registry / plumbing contract so the extraction into terminalRegistry.ts
// is provably behaviour-preserving. Imports from "./terminalRegistry" — the
// terminalService facade re-exports these same names, so consumers are unaffected.
import {
  sessions,
  getSafeEnv,
  SAFE_ENV_KEYS,
  generateSessionId,
  generateId,
  _resetIdCounter,
  MAX_LIVE_SESSIONS,
  MAX_SCROLLBACK_CHARS,
  emitData,
  emitExit,
  attachWs,
  detachWs,
  writeToSession,
  resizeSession,
  killSession,
  listSessions,
  getSession,
  type PtySession,
} from "./terminalRegistry";

function makeSession(over: Partial<PtySession> = {}): PtySession {
  return {
    id: over.id ?? generateSessionId(),
    proc: null,
    cwd: "/tmp",
    type: "shell",
    alive: true,
    ws: null,
    outputBuffer: [],
    exitBuffer: null,
    scrollback: "",
    ...over,
  } as PtySession;
}

function makeWs(readyState = 1) {
  const sent: string[] = [];
  return {
    readyState,
    bufferedAmount: 0,
    sent,
    send: (m: string) => sent.push(m),
    close: () => {},
  };
}

beforeEach(() => {
  sessions.clear();
  _resetIdCounter();
});

describe("id generation", () => {
  test("generateSessionId returns an unguessable, unique term-<uuid>", () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).toMatch(/^term-[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  test("generateId is sequential and resettable", () => {
    _resetIdCounter();
    const first = generateId();
    const second = generateId();
    expect(first).toContain("term-1-");
    expect(second).toContain("term-2-");
  });
});

describe("MAX_LIVE_SESSIONS", () => {
  test("caps concurrent sessions at 50", () => {
    expect(MAX_LIVE_SESSIONS).toBe(50);
  });
});

describe("getSafeEnv", () => {
  test("passes allowlisted keys, LC_* prefix, and drops everything else", () => {
    const saved = { ...process.env };
    try {
      process.env.PATH = "/usr/bin";
      process.env.LC_CUSTOM = "en_US";
      process.env.VK_SUPER_SECRET_TOKEN = "leak-me";
      const env = getSafeEnv();
      expect(env.PATH).toBe("/usr/bin");
      expect(env.LC_CUSTOM).toBe("en_US");
      expect(env.VK_SUPER_SECRET_TOKEN).toBeUndefined();
      expect(SAFE_ENV_KEYS.has("PATH")).toBe(true);
    } finally {
      process.env = saved;
    }
  });
});

describe("emitData", () => {
  test("appends to scrollback and caps it at MAX_SCROLLBACK_CHARS", () => {
    const s = makeSession();
    emitData(s, "x".repeat(MAX_SCROLLBACK_CHARS + 500));
    expect(s.scrollback.length).toBe(MAX_SCROLLBACK_CHARS);
  });

  test("buffers output when no WS is attached", () => {
    const s = makeSession();
    emitData(s, "hello");
    expect(s.outputBuffer).toContain("hello");
  });

  test("sends over an open WS instead of buffering", () => {
    const ws = makeWs(1);
    const s = makeSession({ ws });
    emitData(s, "live");
    expect(s.outputBuffer).toHaveLength(0);
    expect(ws.sent[0]).toContain('"type":"output"');
    expect(ws.sent[0]).toContain("live");
  });

  test("drops the chunk when the socket is backpressured (scrollback still keeps it)", () => {
    const ws = makeWs(1);
    ws.bufferedAmount = 2_000_000;
    const s = makeSession({ ws });
    emitData(s, "congested");
    expect(ws.sent).toHaveLength(0);
    expect(s.scrollback).toContain("congested");
  });
});

describe("emitExit", () => {
  test("buffers the exit code when no WS is attached", () => {
    const s = makeSession();
    emitExit(s, 3);
    expect(s.exitBuffer).toBe(3);
  });

  test("sends the exit over an open WS", () => {
    const ws = makeWs(1);
    const s = makeSession({ ws });
    emitExit(s, 0);
    expect(ws.sent[0]).toContain('"type":"exit"');
  });
});

describe("attachWs / detachWs", () => {
  test("flushes scrollback, buffered output, and buffered exit on attach", () => {
    const id = generateSessionId();
    const s = makeSession({ id, scrollback: "history", outputBuffer: ["buffered"], exitBuffer: 7 });
    sessions.set(id, s);
    const ws = makeWs(1);

    expect(attachWs(id, ws)).toBe(true);
    const joined = ws.sent.join("");
    expect(joined).toContain("history");
    expect(joined).toContain("buffered");
    expect(joined).toContain('"exitCode":7');
    expect(s.outputBuffer).toHaveLength(0);
    expect(s.exitBuffer).toBeNull();
  });

  test("attachWs returns false for an unknown session", () => {
    expect(attachWs("nope", makeWs())).toBe(false);
  });

  test("detachWs clears the socket", () => {
    const id = generateSessionId();
    const s = makeSession({ id, ws: makeWs(1) });
    sessions.set(id, s);
    detachWs(id);
    expect(s.ws).toBeNull();
  });
});

describe("writeToSession / resizeSession", () => {
  test("return false for unknown or dead sessions", () => {
    expect(writeToSession("nope", "x")).toBe(false);
    expect(resizeSession("nope", 80, 24)).toBe(false);
  });

  test("forward to the pty for a live session", () => {
    const id = generateSessionId();
    let written = "";
    let resizedCols = 0;
    let resizedRows = 0;
    const s = makeSession({
      id,
      proc: {
        write: (d: string) => {
          written = d;
        },
        resize: (c: number, r: number) => {
          resizedCols = c;
          resizedRows = r;
        },
        kill: () => {},
      } as any,
    });
    sessions.set(id, s);
    expect(writeToSession(id, "ls\n")).toBe(true);
    expect(written).toBe("ls\n");
    expect(resizeSession(id, 120, 40)).toBe(true);
    expect(resizedCols).toBe(120);
    expect(resizedRows).toBe(40);
  });
});

describe("killSession", () => {
  test("returns false for an unknown session", () => {
    expect(killSession("nope")).toBe(false);
  });

  test("kills the pty, removes the session, and marks it dead", () => {
    const id = generateSessionId();
    let killed = false;
    const s = makeSession({ id, proc: { kill: () => (killed = true) } as any });
    sessions.set(id, s);
    expect(killSession(id)).toBe(true);
    expect(killed).toBe(true);
    expect(s.alive).toBe(false);
    expect(sessions.has(id)).toBe(false);
  });
});

describe("listSessions / getSession", () => {
  test("getSession returns the session by id, undefined otherwise", () => {
    const id = generateSessionId();
    const s = makeSession({ id });
    sessions.set(id, s);
    expect(getSession(id)).toBe(s);
    expect(getSession("nope")).toBeUndefined();
  });

  test("listSessions filters by projectId when provided", () => {
    const a = makeSession({ id: generateSessionId(), projectId: "p1" });
    const b = makeSession({ id: generateSessionId(), projectId: "p2" });
    sessions.set(a.id, a);
    sessions.set(b.id, b);
    expect(listSessions()).toHaveLength(2);
    expect(listSessions("p1")).toEqual([a]);
  });
});
