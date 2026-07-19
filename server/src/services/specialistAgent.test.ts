import { describe, test, expect, afterEach } from "bun:test";
import { getDb } from "../db";
import {
  parseAgentEvent,
  createStreamJsonParser,
  isSpecialistAgenticEnabled,
  agenticAvailable,
  useAgentic,
  buildAgenticPrompt,
} from "./specialistAgent";

function setSetting(key: string, val: unknown) {
  getDb()
    .query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(key, JSON.stringify(val));
}
function delSetting(key: string) {
  getDb().query("DELETE FROM settings WHERE key = ?").run(key);
}

afterEach(() => {
  delete process.env.VK_SPECIALIST_AGENTIC;
  delSetting("mcpEnabled");
  delSetting("mcpAuthRequired");
});

describe("parseAgentEvent", () => {
  test("assistant text block → delta", () => {
    expect(
      parseAgentEvent({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello" }] },
      }),
    ).toEqual([{ type: "delta", text: "Hello" }]);
  });

  test("assistant tool_use → tool frame with query summary", () => {
    const frames = parseAgentEvent({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "cross_project_search", input: { query: "JWT rotation" } },
        ],
      },
    });
    expect(frames).toEqual([
      { type: "tool", name: "cross_project_search", summary: "JWT rotation" },
    ]);
  });

  test("mixed blocks → text + tool, in order; empty text skipped", () => {
    const frames = parseAgentEvent({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "   " },
          { type: "text", text: "Looking…" },
          { type: "tool_use", name: "list_projects", input: {} },
        ],
      },
    });
    expect(frames).toEqual([
      { type: "delta", text: "Looking…" },
      { type: "tool", name: "list_projects", summary: "{}" },
    ]);
  });

  test("successful result and system/user events yield nothing", () => {
    expect(parseAgentEvent({ type: "result", subtype: "success", result: "done" })).toEqual([]);
    expect(parseAgentEvent({ type: "system", subtype: "init" })).toEqual([]);
    expect(
      parseAgentEvent({ type: "user", message: { content: [{ type: "tool_result" }] } }),
    ).toEqual([]);
  });

  test("error result → error frame", () => {
    expect(parseAgentEvent({ type: "result", is_error: true, result: "boom" })).toEqual([
      { type: "error", message: "boom" },
    ]);
    expect(parseAgentEvent({ type: "result", subtype: "error_max_turns" })).toEqual([
      { type: "error", message: "error_max_turns" },
    ]);
  });
});

describe("createStreamJsonParser", () => {
  test("reassembles events split across chunk boundaries + flush handles the tail", () => {
    const p = createStreamJsonParser();
    const a = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hi" }] },
    });
    const b = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "cross_project_memory_search", input: { query: "x" } }],
      },
    });
    // Feed the first event + half of the second; the split line stays buffered.
    const mid = Math.floor(b.length / 2);
    let frames = p.push(`${a}\n${b.slice(0, mid)}`);
    expect(frames).toEqual([{ type: "delta", text: "Hi" }]);
    frames = p.push(`${b.slice(mid)}\n`);
    expect(frames).toEqual([{ type: "tool", name: "cross_project_memory_search", summary: "x" }]);
    // Trailing line with no newline is emitted on flush; blank/garbage ignored.
    p.push("garbage-not-json\n");
    expect(p.flush()).toEqual([]);
  });

  test("fallbackAnswer: the result text, only when no assistant text streamed", () => {
    // No assistant text, only a terminal result → fallback returns the result text.
    const p1 = createStreamJsonParser();
    p1.push(
      `${JSON.stringify({ type: "result", subtype: "success", result: "The answer." })}\n`,
    );
    expect(p1.fallbackAnswer()).toBe("The answer.");

    // Assistant text streamed → no fallback (avoids double-printing).
    const p2 = createStreamJsonParser();
    p2.push(
      `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hi" }] } })}\n` +
        `${JSON.stringify({ type: "result", subtype: "success", result: "Hi" })}\n`,
    );
    expect(p2.fallbackAnswer()).toBeUndefined();
  });
});

describe("gating", () => {
  test("isSpecialistAgenticEnabled: only 'true' or '1'", () => {
    expect(isSpecialistAgenticEnabled()).toBe(false);
    process.env.VK_SPECIALIST_AGENTIC = "1";
    expect(isSpecialistAgenticEnabled()).toBe(true);
    process.env.VK_SPECIALIST_AGENTIC = "true";
    expect(isSpecialistAgenticEnabled()).toBe(true);
    process.env.VK_SPECIALIST_AGENTIC = "yes";
    expect(isSpecialistAgenticEnabled()).toBe(false);
  });

  test("agenticAvailable: needs mcpEnabled AND auth off", () => {
    delSetting("mcpEnabled"); // default → false
    expect(agenticAvailable()).toBe(false);

    setSetting("mcpEnabled", true);
    setSetting("mcpAuthRequired", true);
    expect(agenticAvailable()).toBe(false); // auth on → CLI can't authenticate

    setSetting("mcpAuthRequired", false);
    expect(agenticAvailable()).toBe(true);
  });

  test("useAgentic = opted-in AND available", () => {
    setSetting("mcpEnabled", true);
    setSetting("mcpAuthRequired", false);
    expect(useAgentic()).toBe(false); // not opted in

    process.env.VK_SPECIALIST_AGENTIC = "1";
    expect(useAgentic()).toBe(true);

    setSetting("mcpEnabled", false);
    expect(useAgentic()).toBe(false); // opted in but unavailable → fall back
  });
});

describe("buildAgenticPrompt", () => {
  test("carries the question and names the cross-project tools", () => {
    const p = buildAgenticPrompt("Have we solved JWT rotation?");
    expect(p).toContain("Have we solved JWT rotation?");
    expect(p).toContain("cross_project_search");
    expect(p).toContain("cross_project_memory_search");
  });
});
