import { describe, test, expect } from "bun:test";
import { parseClaudeOutput, getHeadlessClaudeStats } from "./headlessClaude";

describe("parseClaudeOutput", () => {
  test("returns nulls for empty input", () => {
    expect(parseClaudeOutput("")).toEqual({ sessionId: null, summary: null });
    expect(parseClaudeOutput("   \n  ")).toEqual({ sessionId: null, summary: null });
  });

  test("extracts session_id and result from a full JSON object", () => {
    const out = JSON.stringify({
      session_id: "sess-abc",
      result: "did the thing",
      cost_usd: 0.01,
    });
    expect(parseClaudeOutput(out)).toEqual({
      sessionId: "sess-abc",
      summary: "did the thing",
    });
  });

  test("accepts camelCase and 'summary' fallbacks", () => {
    const out = JSON.stringify({
      sessionId: "sess-x",
      summary: "alt-shape",
    });
    expect(parseClaudeOutput(out)).toEqual({
      sessionId: "sess-x",
      summary: "alt-shape",
    });
  });

  test("scans newline-delimited JSON for the last well-formed object", () => {
    const lines = [
      JSON.stringify({ type: "system" }),
      JSON.stringify({ type: "assistant", text: "..." }),
      JSON.stringify({ session_id: "sess-y", result: "tail" }),
    ].join("\n");
    expect(parseClaudeOutput(lines)).toEqual({
      sessionId: "sess-y",
      summary: "tail",
    });
  });

  test("falls back to a tail snippet when nothing parses", () => {
    const out = "not json at all".repeat(200);
    const parsed = parseClaudeOutput(out);
    expect(parsed.sessionId).toBeNull();
    expect(parsed.summary).toBeTruthy();
    expect(parsed.summary!.length).toBeLessThanOrEqual(1000);
  });
});

describe("getHeadlessClaudeStats", () => {
  test("returns numeric stats with cap >= 1", () => {
    const stats = getHeadlessClaudeStats();
    expect(typeof stats.inFlight).toBe("number");
    expect(typeof stats.queued).toBe("number");
    expect(stats.cap).toBeGreaterThanOrEqual(1);
  });
});
