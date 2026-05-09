import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyDirSync,
  hashDir,
  compareDirHashes,
  detectMisFixture,
  evaluateStatus,
  parseClaudeJson,
} from "./run";
import type { BenchResult, BenchStatus } from "./types";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
});

afterEach(() => {
  if (tmpRoot && fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeFixtureLike(root: string): void {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "bench.json"),
    JSON.stringify({ id: "x", mockFix: { "src/a.ts": "answer" } }),
  );
  fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
  fs.writeFileSync(path.join(root, "tests", "target.test.ts"), "test('t', () => {});");
  fs.writeFileSync(path.join(root, "tests", "regression.test.ts"), "test('r', () => {});");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x" }));
}

describe("copyDirSync with ignore predicate", () => {
  test("excludes bench.json from the copy", () => {
    const src = path.join(tmpRoot, "src-fixture");
    const dst = path.join(tmpRoot, "dst");
    fs.mkdirSync(src);
    makeFixtureLike(src);

    copyDirSync(src, dst, (rel) => rel === "bench.json");

    expect(fs.existsSync(path.join(dst, "bench.json"))).toBe(false);
    expect(fs.existsSync(path.join(dst, "src", "a.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dst, "tests", "target.test.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dst, "package.json"))).toBe(true);
  });

  test("without ignore predicate: copies everything", () => {
    const src = path.join(tmpRoot, "src-fixture");
    const dst = path.join(tmpRoot, "dst");
    fs.mkdirSync(src);
    makeFixtureLike(src);

    copyDirSync(src, dst);

    expect(fs.existsSync(path.join(dst, "bench.json"))).toBe(true);
  });

  test("skips .git and node_modules unconditionally", () => {
    const src = path.join(tmpRoot, "src-fixture");
    const dst = path.join(tmpRoot, "dst");
    fs.mkdirSync(path.join(src, ".git"), { recursive: true });
    fs.mkdirSync(path.join(src, "node_modules", "foo"), { recursive: true });
    fs.writeFileSync(path.join(src, ".git", "HEAD"), "ref: refs/heads/main");
    fs.writeFileSync(path.join(src, "node_modules", "foo", "index.js"), "module.exports={}");
    fs.writeFileSync(path.join(src, "keep.ts"), "export {};");

    copyDirSync(src, dst);

    expect(fs.existsSync(path.join(dst, ".git"))).toBe(false);
    expect(fs.existsSync(path.join(dst, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(dst, "keep.ts"))).toBe(true);
  });
});

describe("hashDir + compareDirHashes (tampering guard)", () => {
  test("identical content → no changes detected", () => {
    const dir = path.join(tmpRoot, "tests");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.ts"), "test('a', () => {});");
    fs.writeFileSync(path.join(dir, "b.ts"), "test('b', () => {});");

    const before = hashDir(dir);
    const after = hashDir(dir);
    expect(compareDirHashes(before, after)).toEqual([]);
  });

  test("modified file is detected", () => {
    const dir = path.join(tmpRoot, "tests");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "target.test.ts"), "test('orig', () => {});");

    const before = hashDir(dir);
    fs.writeFileSync(
      path.join(dir, "target.test.ts"),
      "test('orig', () => { expect(true).toBe(true); });",
    );
    const after = hashDir(dir);

    expect(compareDirHashes(before, after)).toEqual(["target.test.ts"]);
  });

  test("added file is detected", () => {
    const dir = path.join(tmpRoot, "tests");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.ts"), "x");

    const before = hashDir(dir);
    fs.writeFileSync(path.join(dir, "b.ts"), "y");
    const after = hashDir(dir);

    expect(compareDirHashes(before, after)).toEqual(["b.ts"]);
  });

  test("removed file is detected", () => {
    const dir = path.join(tmpRoot, "tests");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.ts"), "x");
    fs.writeFileSync(path.join(dir, "b.ts"), "y");

    const before = hashDir(dir);
    fs.rmSync(path.join(dir, "b.ts"));
    const after = hashDir(dir);

    expect(compareDirHashes(before, after)).toEqual(["b.ts"]);
  });

  test("missing dir → empty map (no crash)", () => {
    const before = hashDir(path.join(tmpRoot, "does-not-exist"));
    expect(before.size).toBe(0);
  });

  test("nested files are tracked", () => {
    const dir = path.join(tmpRoot, "tests");
    fs.mkdirSync(path.join(dir, "nested"), { recursive: true });
    fs.writeFileSync(path.join(dir, "nested", "deep.ts"), "x");

    const before = hashDir(dir);
    fs.writeFileSync(path.join(dir, "nested", "deep.ts"), "x-changed");
    const after = hashDir(dir);

    expect(compareDirHashes(before, after)).toEqual(["nested/deep.ts"]);
  });
});

describe("detectMisFixture", () => {
  test("baseline target passes → mis-fixture (nothing to solve)", () => {
    const r = detectMisFixture(0, 0);
    expect(r.misFixture).toBe(true);
    expect(r.reason).toMatch(/already passes/);
  });

  test("baseline target fails AND regression fails → mis-fixture (broken baseline)", () => {
    const r = detectMisFixture(1, 1);
    expect(r.misFixture).toBe(true);
    expect(r.reason).toMatch(/regression/);
  });

  test("baseline target fails, regression holds → ok", () => {
    const r = detectMisFixture(1, 0);
    expect(r.misFixture).toBe(false);
    expect(r.reason).toBeNull();
  });
});

function baseResult(overrides: Partial<BenchResult> = {}): BenchResult {
  return {
    fixtureId: "f",
    title: "t",
    runId: "r",
    startedAt: "now",
    durationMs: 0,
    workDir: "/tmp/x",
    ai: {
      invoked: false,
      exitCode: null,
      durationMs: 0,
      durationApiMs: null,
      summary: null,
      sessionId: null,
      models: [],
      numTurns: null,
      totalCostUsd: null,
      inputTokens: null,
      outputTokens: null,
      stopReason: null,
      terminalReason: null,
      permissionDenials: null,
    },
    tests: {
      targetPassed: true,
      regressionsHeld: true,
      targetExitCode: 0,
      regressionExitCode: 0,
      targetOutput: "",
      regressionOutput: "",
    },
    diff: {
      filesChanged: ["src/a.ts"],
      linesAdded: 1,
      linesRemoved: 1,
      withinBudget: true,
      expectedFilesOnly: true,
    },
    preflight: { ran: false, misFixture: false, reason: null },
    tampering: { checked: false, detected: false, changedFiles: [] },
    chain: {
      depth: 1,
      parentLinksValid: true,
      leafTaskId: null,
      leafStatus: null,
      totalAiRuns: 0,
      totalDurationMs: 0,
      totalCostUsd: 0,
      expectedDepth: null,
      expectedDepthMet: true,
    },
    concurrency: {
      checked: false,
      statsBefore: null,
      statsAfter: null,
      slotLeak: false,
      timedOut: false,
    },
    sideEffects: {
      checked: false,
      taskAiRun: {
        found: false,
        exitCode: null,
        success: null,
        durationMs: null,
        sessionIdSet: false,
        summarySet: false,
      },
      timestamps: {
        inboxAtSet: false,
        inProgressAtSet: false,
        doneAtSet: false,
        cascadeOrdered: false,
      },
      snapshot: { fileExists: false, taskInSnapshot: false },
      embeddings: { rowCount: 0, skipped: false },
      allGreen: false,
    },
    multiFile: {
      checked: false,
      required: [],
      missing: [],
      trivial: [],
      allTouched: true,
    },
    status: "ERROR",
    solved: false,
    error: null,
    ...overrides,
  };
}

describe("evaluateStatus", () => {
  const cases: Array<[string, Partial<BenchResult>, boolean, BenchStatus]> = [
    [
      "error short-circuits everything",
      {
        error: "boom",
        tests: {
          targetPassed: true,
          regressionsHeld: true,
          targetExitCode: 0,
          regressionExitCode: 0,
          targetOutput: "",
          regressionOutput: "",
        },
      },
      false,
      "ERROR",
    ],
    [
      "mis-fixture short-circuits",
      { preflight: { ran: true, misFixture: true, reason: "x" } },
      false,
      "MIS-FIXTURE",
    ],
    [
      "tampered short-circuits",
      { tampering: { checked: true, detected: true, changedFiles: ["tests/a.ts"] } },
      false,
      "TAMPERED",
    ],
    ["target+reg pass, strict, within gates → SOLVED", {}, false, "SOLVED"],
    [
      "target+reg pass, strict, over budget → SPRAWL",
      {
        diff: {
          filesChanged: ["src/a.ts"],
          linesAdded: 100,
          linesRemoved: 0,
          withinBudget: false,
          expectedFilesOnly: true,
        },
      },
      false,
      "SPRAWL",
    ],
    [
      "target+reg pass, strict, unexpected files → SPRAWL",
      {
        diff: {
          filesChanged: ["src/x.ts"],
          linesAdded: 1,
          linesRemoved: 0,
          withinBudget: true,
          expectedFilesOnly: false,
        },
      },
      false,
      "SPRAWL",
    ],
    [
      "target+reg pass, lenient, over budget → SOLVED",
      {
        diff: {
          filesChanged: ["src/a.ts"],
          linesAdded: 100,
          linesRemoved: 0,
          withinBudget: false,
          expectedFilesOnly: false,
        },
      },
      true,
      "SOLVED",
    ],
    [
      "target pass, reg broke → TARGET-ONLY",
      {
        tests: {
          targetPassed: true,
          regressionsHeld: false,
          targetExitCode: 0,
          regressionExitCode: 1,
          targetOutput: "",
          regressionOutput: "",
        },
      },
      false,
      "TARGET-ONLY",
    ],
    [
      "target fail, reg held → TARGET-FAIL",
      {
        tests: {
          targetPassed: false,
          regressionsHeld: true,
          targetExitCode: 1,
          regressionExitCode: 0,
          targetOutput: "",
          regressionOutput: "",
        },
      },
      false,
      "TARGET-FAIL",
    ],
    [
      "target fail + reg broke → REGRESSED",
      {
        tests: {
          targetPassed: false,
          regressionsHeld: false,
          targetExitCode: 1,
          regressionExitCode: 1,
          targetOutput: "",
          regressionOutput: "",
        },
      },
      false,
      "REGRESSED",
    ],
    [
      "concurrency.timedOut + target fail → TIMEOUT (overrides TARGET-FAIL)",
      {
        tests: {
          targetPassed: false,
          regressionsHeld: true,
          targetExitCode: 1,
          regressionExitCode: 0,
          targetOutput: "",
          regressionOutput: "",
        },
        concurrency: {
          checked: true,
          statsBefore: null,
          statsAfter: null,
          slotLeak: false,
          timedOut: true,
        },
      },
      false,
      "TIMEOUT",
    ],
    [
      "concurrency.timedOut + target pass → SOLVED (don't downgrade real success)",
      {
        tests: {
          targetPassed: true,
          regressionsHeld: true,
          targetExitCode: 0,
          regressionExitCode: 0,
          targetOutput: "",
          regressionOutput: "",
        },
        concurrency: {
          checked: true,
          statsBefore: null,
          statsAfter: null,
          slotLeak: false,
          timedOut: true,
        },
      },
      false,
      "SOLVED",
    ],
    [
      "target+reg pass, strict, requireFiles missing → INSUFFICIENT-FILES",
      {
        multiFile: {
          checked: true,
          required: ["src/a.ts", "src/b.ts"],
          missing: ["src/b.ts"],
          trivial: [],
          allTouched: false,
        },
      },
      false,
      "INSUFFICIENT-FILES",
    ],
    [
      "target+reg pass, strict, requireFiles trivial → INSUFFICIENT-FILES",
      {
        multiFile: {
          checked: true,
          required: ["src/a.ts", "src/b.ts"],
          missing: [],
          trivial: ["src/b.ts"],
          allTouched: false,
        },
      },
      false,
      "INSUFFICIENT-FILES",
    ],
    [
      "target+reg pass, lenient, requireFiles missing → SOLVED",
      {
        multiFile: {
          checked: true,
          required: ["src/a.ts", "src/b.ts"],
          missing: ["src/b.ts"],
          trivial: [],
          allTouched: false,
        },
      },
      true,
      "SOLVED",
    ],
    [
      "target+reg pass, strict, requireFiles allTouched → SOLVED",
      {
        multiFile: {
          checked: true,
          required: ["src/a.ts", "src/b.ts"],
          missing: [],
          trivial: [],
          allTouched: true,
        },
      },
      false,
      "SOLVED",
    ],
    [
      "target fail + requireFiles missing → TARGET-FAIL (multiFile only checked when target+reg pass)",
      {
        tests: {
          targetPassed: false,
          regressionsHeld: true,
          targetExitCode: 1,
          regressionExitCode: 0,
          targetOutput: "",
          regressionOutput: "",
        },
        multiFile: {
          checked: true,
          required: ["src/a.ts", "src/b.ts"],
          missing: ["src/b.ts"],
          trivial: [],
          allTouched: false,
        },
      },
      false,
      "TARGET-FAIL",
    ],
  ];

  for (const [label, overrides, lenient, want] of cases) {
    test(label, () => {
      const r = baseResult(overrides);
      expect(evaluateStatus(r, lenient)).toBe(want);
    });
  }
});

describe("parseClaudeJson", () => {
  test("empty input → all-null shape", () => {
    const r = parseClaudeJson("");
    expect(r.summary).toBeNull();
    expect(r.sessionId).toBeNull();
    expect(r.models).toEqual([]);
    expect(r.numTurns).toBeNull();
    expect(r.totalCostUsd).toBeNull();
  });

  test("real-shape result JSON: captures all fields", () => {
    const real = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1803,
      duration_api_ms: 2698,
      num_turns: 1,
      result: "All tests pass.",
      stop_reason: "end_turn",
      session_id: "abc-123",
      total_cost_usd: 0.17,
      usage: { input_tokens: 6, output_tokens: 6 },
      modelUsage: {
        "claude-haiku-4-5-20251001": { inputTokens: 346, outputTokens: 13 },
        "claude-opus-4-7": { inputTokens: 6, outputTokens: 6 },
      },
      permission_denials: [],
      terminal_reason: "completed",
    });
    const r = parseClaudeJson(real);
    expect(r.summary).toBe("All tests pass.");
    expect(r.sessionId).toBe("abc-123");
    expect(r.models.sort()).toEqual(["claude-haiku-4-5-20251001", "claude-opus-4-7"]);
    expect(r.numTurns).toBe(1);
    expect(r.totalCostUsd).toBeCloseTo(0.17, 5);
    expect(r.durationApiMs).toBe(2698);
    expect(r.inputTokens).toBe(6);
    expect(r.outputTokens).toBe(6);
    expect(r.stopReason).toBe("end_turn");
    expect(r.terminalReason).toBe("completed");
    expect(r.permissionDenials).toBe(0);
  });

  test("non-JSON output: summary falls back to tail of stdout", () => {
    const r = parseClaudeJson("oops\nsome non-json error trace\nat the end");
    expect(r.summary).toContain("at the end");
    expect(r.sessionId).toBeNull();
    expect(r.models).toEqual([]);
  });

  test("streaming-JSON tail: recovers result line", () => {
    const stream = [
      '{"type":"system","sessionId":"x"}',
      '{"type":"assistant","content":"thinking"}',
      JSON.stringify({
        type: "result",
        result: "done",
        session_id: "ssn",
        num_turns: 2,
        total_cost_usd: 0.05,
      }),
    ].join("\n");
    const r = parseClaudeJson(stream);
    expect(r.summary).toBe("done");
    expect(r.sessionId).toBe("ssn");
    expect(r.numTurns).toBe(2);
    expect(r.totalCostUsd).toBeCloseTo(0.05, 5);
  });

  test("missing optional fields stay null", () => {
    const minimal = JSON.stringify({ result: "x", session_id: "y" });
    const r = parseClaudeJson(minimal);
    expect(r.summary).toBe("x");
    expect(r.sessionId).toBe("y");
    expect(r.numTurns).toBeNull();
    expect(r.totalCostUsd).toBeNull();
    expect(r.models).toEqual([]);
    expect(r.permissionDenials).toBeNull();
  });
});

describe("--ci flag end-to-end (subprocess)", () => {
  const REPO_ROOT = path.resolve(import.meta.dir, "../..");
  const RUN_SCRIPT = path.resolve(import.meta.dir, "run.ts");

  async function runHarness(
    args: string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn([process.execPath, RUN_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  }

  test("--ci no baseline: exits 0 when all solved", async () => {
    const res = await runHarness(["--mock", "--ci", "--fixture=01-bug-fix-arithmetic"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("bench-ci");
    expect(res.stdout).toMatch(/solved 1\/1/);
  });

  test("--ci no baseline: exits 1 when any failed", async () => {
    const res = await runHarness(["--dry-run", "--ci", "--fixture=01-bug-fix-arithmetic"]);
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toContain("bench-ci");
    expect(res.stdout).toMatch(/failed=1/);
  });

  test("--ci with baseline (regression): exits 1 + names regressed fixtures", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vk-bench-ci-"));
    const baseline = path.join(tmp, "baseline.json");
    fs.writeFileSync(
      baseline,
      JSON.stringify({
        generatedAt: "2026-01-01T00:00:00.000Z",
        reportsScanned: 1,
        resultsScanned: 1,
        byFixture: [
          {
            key: "01-bug-fix-arithmetic",
            total: 1,
            solved: 1,
            solveRate: 1.0,
            totalCostUsd: 0,
            totalDurationMs: 0,
          },
        ],
        byModel: [],
        byWeek: [],
        totalCostUsd: 0,
        overBudgetFixtures: [],
      }),
    );
    const res = await runHarness([
      "--dry-run",
      "--ci",
      `--baseline=${baseline}`,
      "--fixture=01-bug-fix-arithmetic",
    ]);
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toContain("regressed=1");
    expect(res.stderr).toContain("01-bug-fix-arithmetic");
    fs.rmSync(tmp, { recursive: true, force: true });
  }, 30_000);

  test("--ci --comment-out writes baseline delta markdown", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vk-bench-ci-"));
    const baseline = path.join(tmp, "baseline.json");
    const commentPath = path.join(tmp, "comment.md");
    fs.writeFileSync(
      baseline,
      JSON.stringify({
        generatedAt: "2026-01-01T00:00:00.000Z",
        reportsScanned: 1,
        resultsScanned: 1,
        byFixture: [
          {
            key: "01-bug-fix-arithmetic",
            total: 1,
            solved: 1,
            solveRate: 1.0,
            totalCostUsd: 0,
            totalDurationMs: 0,
          },
        ],
        byModel: [],
        byWeek: [],
        totalCostUsd: 0,
        overBudgetFixtures: [],
      }),
    );
    const res = await runHarness([
      "--mock",
      "--ci",
      `--baseline=${baseline}`,
      `--comment-out=${commentPath}`,
      "--fixture=01-bug-fix-arithmetic",
    ]);
    expect(res.exitCode).toBe(0);
    expect(fs.existsSync(commentPath)).toBe(true);
    const md = fs.readFileSync(commentPath, "utf-8");
    expect(md).toContain("Bench delta vs main");
    expect(md).toContain("Regressed");
    expect(md).toContain("Cost delta");
    fs.rmSync(tmp, { recursive: true, force: true });
  }, 30_000);

  test("--baseline missing: exits 2", async () => {
    const res = await runHarness([
      "--mock",
      "--ci",
      "--baseline=/tmp/nonexistent-bench-baseline-xyz.json",
      "--fixture=01-bug-fix-arithmetic",
    ]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain("baseline not found");
  });
});
