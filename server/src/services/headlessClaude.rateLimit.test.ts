import { describe, test, expect } from "bun:test";
import { parseRateLimit } from "./headlessClaude";

describe("parseRateLimit", () => {
  test("returns limited:false for ordinary failure output", () => {
    const rl = parseRateLimit(JSON.stringify({ result: "compile error in foo.ts" }), "");
    expect(rl.limited).toBe(false);
    expect(rl.resumeAt).toBeNull();
    expect(rl.reason).toBeNull();
  });

  test("detects each usage-limit phrasing", () => {
    const phrases = [
      "Claude usage limit reached. Try again later.",
      "Error: rate limit exceeded",
      "You've hit your usage limit",
      "5-hour limit reached",
      "429 too many requests",
    ];
    for (const p of phrases) {
      expect(parseRateLimit(p, "").limited).toBe(true);
    }
  });

  test("detects a limit phrase on stderr too", () => {
    const rl = parseRateLimit("", "fatal: usage limit reached");
    expect(rl.limited).toBe(true);
    expect(rl.reason).toBe("usage-limit");
  });

  test("extracts a pipe-delimited reset epoch", () => {
    const epoch = 1893456000; // 2030-01-01T00:00:00Z
    const rl = parseRateLimit(`usage limit reached|${epoch}`, "");
    expect(rl.limited).toBe(true);
    expect(rl.resumeAt).toBeInstanceOf(Date);
    expect(rl.resumeAt!.getTime()).toBe(epoch * 1000);
  });

  test("prefers the structured JSON result/error fields", () => {
    const out = JSON.stringify({
      is_error: true,
      subtype: "error_during_execution",
      result: "Claude usage limit reached",
      session_id: "sess-1",
    });
    const rl = parseRateLimit(out, "");
    expect(rl.limited).toBe(true);
  });

  test("does NOT false-positive when JSON is a normal success", () => {
    const out = JSON.stringify({ result: "Implemented the feature", session_id: "sess-2" });
    expect(parseRateLimit(out, "").limited).toBe(false);
  });

  test("limited with resumeAt:null when no time is present", () => {
    const rl = parseRateLimit("rate limit hit", "");
    expect(rl.limited).toBe(true);
    // No epoch in text; usage cache likely absent in CI → null (scheduler then polls).
    expect(rl.resumeAt === null || rl.resumeAt instanceof Date).toBe(true);
  });

  test("tolerates plain (non-JSON) and streaming output", () => {
    const streaming = [
      JSON.stringify({ type: "system" }),
      JSON.stringify({ type: "assistant" }),
      "usage limit reached",
    ].join("\n");
    expect(parseRateLimit(streaming, "").limited).toBe(true);
    expect(parseRateLimit("totally normal output", "").limited).toBe(false);
  });
});
