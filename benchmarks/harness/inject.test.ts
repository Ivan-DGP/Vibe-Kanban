import { describe, test, expect } from "bun:test";
import { buildInjectionEnv, listInjectionModes, classifyInjection } from "./inject";

describe("buildInjectionEnv", () => {
  test("undefined spec → empty env", () => {
    expect(buildInjectionEnv(undefined)).toEqual({});
  });

  test("empty spec → empty env", () => {
    expect(buildInjectionEnv({})).toEqual({});
  });

  test("outputFormatBroken sets VK_INJECT_OUTPUT_FORMAT_BROKEN=1", () => {
    expect(buildInjectionEnv({ outputFormatBroken: true })).toEqual({
      VK_INJECT_OUTPUT_FORMAT_BROKEN: "1",
    });
  });

  test("killAfterMs floors to integer string", () => {
    expect(buildInjectionEnv({ killAfterMs: 350.7 })).toEqual({
      VK_INJECT_KILL_AFTER_MS: "350",
    });
  });

  test("killAfterMs=0 is omitted", () => {
    expect(buildInjectionEnv({ killAfterMs: 0 })).toEqual({});
  });

  test("mcp500Rate clamps to [0,1]", () => {
    expect(buildInjectionEnv({ mcp500Rate: 2.5 })).toEqual({
      VK_INJECT_MCP_500_RATE: "1",
    });
    expect(buildInjectionEnv({ mcp500Rate: 0.4 })).toEqual({
      VK_INJECT_MCP_500_RATE: "0.4",
    });
    expect(buildInjectionEnv({ mcp500Rate: 0 })).toEqual({});
  });

  test("claudeNotFound sets VK_INJECT_CLAUDE_NOT_FOUND=1", () => {
    expect(buildInjectionEnv({ claudeNotFound: true })).toEqual({
      VK_INJECT_CLAUDE_NOT_FOUND: "1",
    });
  });

  test("multiple modes combined", () => {
    expect(
      buildInjectionEnv({
        outputFormatBroken: true,
        killAfterMs: 250,
        mcp500Rate: 0.5,
      }),
    ).toEqual({
      VK_INJECT_OUTPUT_FORMAT_BROKEN: "1",
      VK_INJECT_KILL_AFTER_MS: "250",
      VK_INJECT_MCP_500_RATE: "0.5",
    });
  });
});

describe("listInjectionModes", () => {
  test("undefined → empty", () => {
    expect(listInjectionModes(undefined)).toEqual([]);
  });

  test("only positive killAfterMs counts", () => {
    expect(listInjectionModes({ killAfterMs: 0 })).toEqual([]);
    expect(listInjectionModes({ killAfterMs: 100 })).toEqual(["killAfterMs"]);
  });

  test("orders modes deterministically", () => {
    expect(
      listInjectionModes({
        outputFormatBroken: true,
        killAfterMs: 100,
        mcp500Rate: 0.5,
        claudeNotFound: true,
      }),
    ).toEqual(["outputFormatBroken", "killAfterMs", "mcp500Rate", "claudeNotFound"]);
  });
});

describe("classifyInjection — outputFormatBroken", () => {
  const baseArgs = {
    spec: { outputFormatBroken: true } as const,
    exitCode: 0,
    rowFound: true,
    rowExitCode: 0,
    slotLeaked: false,
    summary: null as string | null,
    pipelineError: null as string | null,
    mcp500Count: 0,
  };

  test("null summary → surfaced (parser fallback handled malformed JSON)", () => {
    const r = classifyInjection({ ...baseArgs, summary: null });
    expect(r.surfaced).toBe(true);
    expect(r.recovered).toBe(true);
    expect(r.notes.some((n) => n.includes("parser fallback"))).toBe(true);
  });

  test("garbage tail summary without session_id → surfaced", () => {
    const r = classifyInjection({
      ...baseArgs,
      summary: '{"type":"result","subtype":"success","is_err',
    });
    expect(r.surfaced).toBe(true);
  });

  test("clean envelope summary → NOT surfaced (suspicious — parser may have bypassed)", () => {
    const r = classifyInjection({
      ...baseArgs,
      summary: '{"session_id":"abc","result":"ok"}',
    });
    expect(r.surfaced).toBe(false);
  });

  test("slotLeak fails recovered even when surfaced", () => {
    const r = classifyInjection({ ...baseArgs, summary: null, slotLeaked: true });
    expect(r.surfaced).toBe(true);
    expect(r.recovered).toBe(false);
    expect(r.notes).toContain("slot leak");
  });
});

describe("classifyInjection — killAfterMs", () => {
  const baseArgs = {
    spec: { killAfterMs: 300 } as const,
    exitCode: 137,
    rowFound: true,
    rowExitCode: 137,
    slotLeaked: false,
    summary: null as string | null,
    pipelineError: null as string | null,
    mcp500Count: 0,
  };

  test("non-zero rowExitCode recorded → surfaced + recovered", () => {
    const r = classifyInjection(baseArgs);
    expect(r.surfaced).toBe(true);
    expect(r.recovered).toBe(true);
    expect(r.notes.some((n) => n.includes("kill recorded"))).toBe(true);
  });

  test("rowExitCode=0 with killed model → silent SOLVED, not surfaced", () => {
    const r = classifyInjection({ ...baseArgs, rowExitCode: 0 });
    expect(r.surfaced).toBe(false);
    expect(r.notes).toContain("kill not recorded — silent SOLVED");
  });

  test("no row written → not recovered (rowFound=false)", () => {
    const r = classifyInjection({ ...baseArgs, rowFound: false, rowExitCode: null });
    expect(r.surfaced).toBe(false);
    expect(r.recovered).toBe(false);
    expect(r.notes).toContain("no task_ai_runs row written");
  });
});

describe("classifyInjection — mcp500Rate", () => {
  const baseArgs = {
    spec: { mcp500Rate: 1.0 } as const,
    exitCode: 0,
    rowFound: true,
    rowExitCode: 0,
    slotLeaked: false,
    summary: null as string | null,
    pipelineError: null as string | null,
    mcp500Count: 1,
  };

  test("count > 0 → surfaced + recovered", () => {
    const r = classifyInjection(baseArgs);
    expect(r.surfaced).toBe(true);
    expect(r.recovered).toBe(true);
  });

  test("count 0 → not surfaced (injection set but no traffic observed)", () => {
    const r = classifyInjection({ ...baseArgs, mcp500Count: 0 });
    expect(r.surfaced).toBe(false);
    expect(r.notes).toContain("MCP injection set but no 5xx observed");
  });
});

describe("classifyInjection — claudeNotFound", () => {
  const baseArgs = {
    spec: { claudeNotFound: true } as const,
    exitCode: null as number | null,
    rowFound: false,
    rowExitCode: null,
    slotLeaked: false,
    summary: null as string | null,
    pipelineError: null as string | null,
    mcp500Count: 0,
  };

  test("ENOENT in pipelineError → surfaced", () => {
    const r = classifyInjection({
      ...baseArgs,
      pipelineError: "spawn claude ENOENT",
    });
    expect(r.surfaced).toBe(true);
    expect(r.notes).toContain("missing CLI surfaced as pipeline error");
  });

  test("non-zero exitCode → surfaced", () => {
    const r = classifyInjection({ ...baseArgs, exitCode: 1 });
    expect(r.surfaced).toBe(true);
  });

  test("clean exit + no error → silent SOLVED", () => {
    const r = classifyInjection({ ...baseArgs, exitCode: 0 });
    expect(r.surfaced).toBe(false);
    expect(r.notes).toContain("missing CLI did not surface — silent SOLVED");
  });
});

describe("classifyInjection — expect overrides", () => {
  test("expectExitNonZero with rowExitCode=0 forces surfaced=false", () => {
    const r = classifyInjection({
      spec: { killAfterMs: 100, expectExitNonZero: true },
      exitCode: 137,
      rowFound: true,
      rowExitCode: 0, // model "recovered" cleanly — but we expected non-zero
      slotLeaked: false,
      summary: null,
      pipelineError: null,
      mcp500Count: 0,
    });
    expect(r.surfaced).toBe(false);
    expect(r.notes.some((n) => n.includes("expected non-zero exit"))).toBe(true);
  });

  test("expectSummaryEmpty with clean envelope forces surfaced=false", () => {
    const r = classifyInjection({
      spec: { outputFormatBroken: true, expectSummaryEmpty: true },
      exitCode: 0,
      rowFound: true,
      rowExitCode: 0,
      slotLeaked: false,
      summary: '{"session_id":"abc","result":"clean"}',
      pipelineError: null,
      mcp500Count: 0,
    });
    expect(r.surfaced).toBe(false);
    expect(r.notes.some((n) => n.includes("expected empty/garbage summary"))).toBe(true);
  });
});
