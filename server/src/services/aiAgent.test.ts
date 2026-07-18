import { describe, test, expect, mock } from "bun:test";

// Control what the settings query returns per-test.
let settingsRow: { value: string } | undefined;
mock.module("../db", () => ({
  getDb: () => ({
    prepare: () => ({ get: () => settingsRow }),
  }),
}));

// Control what `which` returns per-test.
let whichResult = { stdout: "/usr/bin/claude", exitCode: 0 };
mock.module("../lib/runtime", () => ({
  spawnProcessSync: () => whichResult,
}));

import {
  AI_AGENTS,
  buildResolveArgs,
  getConfiguredAgent,
  resolveAgentBinary,
  isAgentAvailable,
} from "./aiAgent";

describe("aiAgent — buildResolveArgs", () => {
  test("claude: identical to the original hardcoded resolve command", () => {
    const args = buildResolveArgs("claude", { prompt: "do the thing", claudeSessionId: "sid-1" });
    expect(args).toEqual([
      "--session-id",
      "sid-1",
      "--dangerously-skip-permissions",
      "do the thing",
    ]);
  });

  test("claude: prompt is always the final arg", () => {
    const args = buildResolveArgs("claude", { prompt: "P", claudeSessionId: "s" });
    expect(args[args.length - 1]).toBe("P");
  });

  test("claude: model is appended before the prompt when set", () => {
    const args = buildResolveArgs("claude", { prompt: "P", claudeSessionId: "s", model: "opus" });
    expect(args).toEqual([
      "--session-id",
      "s",
      "--dangerously-skip-permissions",
      "--model",
      "opus",
      "P",
    ]);
  });

  test("opencode: run --auto with prompt as final arg", () => {
    const args = buildResolveArgs("opencode", { prompt: "do the thing" });
    expect(args).toEqual(["run", "--auto", "do the thing"]);
  });

  test("opencode: -m model when set, prompt still last", () => {
    const args = buildResolveArgs("opencode", { prompt: "P", model: "anthropic/claude-sonnet-5" });
    expect(args).toEqual(["run", "--auto", "-m", "anthropic/claude-sonnet-5", "P"]);
  });

  test("opencode: ignores claudeSessionId (cannot pin)", () => {
    const args = buildResolveArgs("opencode", { prompt: "P", claudeSessionId: "s" });
    expect(args).not.toContain("s");
    expect(args).not.toContain("--session-id");
  });

  test("grok: headless -p with the prompt as its value", () => {
    const args = buildResolveArgs("grok", { prompt: "do the thing" });
    expect(args).toEqual(["-p", "do the thing"]);
  });

  test("grok: -m model appended when set", () => {
    const args = buildResolveArgs("grok", { prompt: "P", model: "grok-code" });
    expect(args).toEqual(["-p", "P", "-m", "grok-code"]);
  });

  test("grok: ignores claudeSessionId (cannot pin)", () => {
    const args = buildResolveArgs("grok", { prompt: "P", claudeSessionId: "s" });
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("s");
  });
});

describe("aiAgent — getConfiguredAgent", () => {
  test("defaults to claude when no setting row", () => {
    settingsRow = undefined;
    expect(getConfiguredAgent()).toBe("claude");
  });

  test("returns opencode when set", () => {
    settingsRow = { value: JSON.stringify("opencode") };
    expect(getConfiguredAgent()).toBe("opencode");
  });

  test("returns grok when set", () => {
    settingsRow = { value: JSON.stringify("grok") };
    expect(getConfiguredAgent()).toBe("grok");
  });

  test("falls back to claude on an unknown value", () => {
    settingsRow = { value: JSON.stringify("bogus") };
    expect(getConfiguredAgent()).toBe("claude");
  });
});

describe("aiAgent — binary resolution", () => {
  test("resolveAgentBinary returns the which path on success", () => {
    whichResult = { stdout: "/opt/bin/opencode", exitCode: 0 };
    expect(resolveAgentBinary("opencode", {})).toBe("/opt/bin/opencode");
  });

  test("resolveAgentBinary falls back to the bare name when which fails", () => {
    whichResult = { stdout: "", exitCode: 1 };
    expect(resolveAgentBinary("opencode", {})).toBe("opencode");
  });

  test("isAgentAvailable reflects the which exit code", () => {
    whichResult = { stdout: "/usr/bin/claude", exitCode: 0 };
    expect(isAgentAvailable("claude", {})).toBe(true);
    whichResult = { stdout: "", exitCode: 1 };
    expect(isAgentAvailable("claude", {})).toBe(false);
  });

  test("AI_AGENTS lists all agents", () => {
    expect(AI_AGENTS).toEqual(["claude", "opencode", "grok"]);
  });
});
