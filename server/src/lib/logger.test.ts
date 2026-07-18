import { describe, test, expect, spyOn } from "bun:test";
import { log, setLogSink, type LogEntry } from "./logger";

// P2.6: the logger no longer writes to SQLite directly — it dispatches entries
// to a sink the composition root (app.ts) registers. These tests cover the
// logger's own contract (buffer → dispatch → console fallback); the DB-persist
// path lives in app.ts and is exercised by the integration tests that boot the app.

describe("logger", () => {
  test("buffers entries emitted before a sink is registered, then flushes on setLogSink", () => {
    const captured: LogEntry[] = [];
    // No sink registered yet — must buffer, not drop.
    log("info", "server", "pre-sink message", { key: "value" });
    setLogSink((e) => captured.push(e));
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      level: "info",
      category: "server",
      message: "pre-sink message",
      details: { key: "value" },
    });
  });

  test("forwards level, category, message, and details to the sink", () => {
    const captured: LogEntry[] = [];
    setLogSink((e) => captured.push(e));
    log("warn", "git", "structured entry", { detail: "test" });

    const entry = captured.at(-1)!;
    expect(entry.level).toBe("warn");
    expect(entry.category).toBe("git");
    expect(entry.message).toBe("structured entry");
    expect(entry.details).toEqual({ detail: "test" });
  });

  test("works without a details parameter", () => {
    const captured: LogEntry[] = [];
    setLogSink((e) => captured.push(e));
    log("error", "tasks", "no details here");

    const entry = captured.at(-1)!;
    expect(entry.message).toBe("no details here");
    expect(entry.details).toBeUndefined();
  });

  test("falls back to console.error when the sink throws", () => {
    setLogSink(() => {
      throw new Error("simulated sink failure");
    });

    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      log("warn", "server", "fallback test message");
      expect(spy).toHaveBeenCalled();
      const [firstArg] = spy.mock.calls[0];
      expect(firstArg).toContain("[warn][server]");
      expect(firstArg).toContain("fallback test message");
    } finally {
      spy.mockRestore();
    }
  });
});
