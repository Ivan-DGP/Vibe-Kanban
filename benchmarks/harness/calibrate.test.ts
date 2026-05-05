import { describe, test, expect } from "bun:test";
import { calibrate, formatCalibrationText, formatCalibrationMd } from "./calibrate";
import type { BenchReport, BenchResult, BenchSpec } from "./types";

function makeResult(over: Partial<BenchResult> = {}): BenchResult {
  const r: BenchResult = {
    fixtureId: "01-bug-fix-arithmetic",
    title: "t",
    runId: "00000000",
    startedAt: "2026-05-04T00:00:00.000Z",
    durationMs: 1000,
    workDir: "/tmp/x",
    ai: {
      invoked: true,
      exitCode: 0,
      durationMs: 100,
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
    tests: { targetPassed: true, regressionsHeld: true, targetExitCode: 0, regressionExitCode: 0, targetOutput: "", regressionOutput: "" },
    diff: { filesChanged: [], linesAdded: 0, linesRemoved: 0, withinBudget: true, expectedFilesOnly: true },
    preflight: { ran: false, misFixture: false, reason: null },
    tampering: { checked: false, detected: false, changedFiles: [] },
    chain: { depth: 1, parentLinksValid: true, leafTaskId: null, leafStatus: null, totalAiRuns: 0, totalDurationMs: 0, totalCostUsd: 0, expectedDepth: null, expectedDepthMet: true },
    concurrency: { checked: false, statsBefore: null, statsAfter: null, slotLeak: false, timedOut: false },
    sideEffects: {
      checked: false,
      taskAiRun: { found: false, exitCode: null, success: null, durationMs: null, sessionIdSet: false, summarySet: false },
      timestamps: { inboxAtSet: false, inProgressAtSet: false, doneAtSet: false, cascadeOrdered: false },
      snapshot: { fileExists: false, taskInSnapshot: false },
      embeddings: { rowCount: 0, skipped: false },
      allGreen: false,
    },
    status: "SOLVED",
    solved: true,
    error: null,
  };
  Object.assign(r, over);
  if (over.ai) r.ai = { ...r.ai, ...over.ai };
  return r;
}

function makeReport(results: BenchResult[], startedAt = "2026-05-04T00:00:00.000Z"): BenchReport {
  return {
    startedAt,
    finishedAt: startedAt,
    totalMs: 1000,
    count: results.length,
    solvedCount: results.filter((r) => r.solved).length,
    results,
  };
}

function spec(id: string, over: Partial<BenchSpec> = {}): BenchSpec {
  return {
    id,
    title: `Title ${id}`,
    category: "test",
    difficulty: "medium",
    prompt: "",
    targetTestPath: "",
    regressionTestPath: "",
    maxDiffLines: 100,
    timeoutMs: 60000,
    ...over,
  };
}

const NOW = new Date("2026-05-05T00:00:00.000Z");

describe("calibrate window filtering", () => {
  test("excludes reports older than the window", () => {
    const inside = makeReport([makeResult({ fixtureId: "a", solved: true })], "2026-05-04T00:00:00.000Z");
    const outside = makeReport([makeResult({ fixtureId: "a", solved: false, status: "TARGET-FAIL" })], "2026-01-01T00:00:00.000Z");
    const c = calibrate([inside, outside], new Map([["a", spec("a")]]), { now: NOW, windowDays: 30, minSamples: 1 });
    expect(c.reportsScanned).toBe(1);
    expect(c.fixtures[0]!.total).toBe(1);
    expect(c.fixtures[0]!.solved).toBe(1);
  });
  test("invalid startedAt is dropped", () => {
    const bad = makeReport([makeResult({ fixtureId: "a" })], "not-a-date");
    const c = calibrate([bad], new Map(), { now: NOW, minSamples: 1 });
    expect(c.reportsScanned).toBe(0);
  });
});

describe("calibrate threshold logic", () => {
  test("solveRate ≥ trivialThreshold → trivial", () => {
    const reps = [makeReport(Array.from({ length: 20 }, () => makeResult({ fixtureId: "a", solved: true })))];
    const c = calibrate(reps, new Map([["a", spec("a")]]), { now: NOW, minSamples: 3 });
    expect(c.fixtures[0]!.recommendation).toBe("trivial");
  });
  test("solveRate ≤ harderThreshold → harder", () => {
    const results = [
      ...Array.from({ length: 1 }, () => makeResult({ fixtureId: "b", solved: true })),
      ...Array.from({ length: 9 }, () => makeResult({ fixtureId: "b", solved: false, status: "TARGET-FAIL" })),
    ];
    const c = calibrate([makeReport(results)], new Map([["b", spec("b", { difficulty: "hard" })]]), { now: NOW, minSamples: 3 });
    expect(c.fixtures[0]!.recommendation).toBe("harder");
    expect(c.fixtures[0]!.solveRate).toBeCloseTo(0.1);
  });
  test("solveRate between thresholds → ok", () => {
    const results = [
      makeResult({ fixtureId: "c", solved: true }),
      makeResult({ fixtureId: "c", solved: false, status: "TARGET-FAIL" }),
      makeResult({ fixtureId: "c", solved: true }),
    ];
    const c = calibrate([makeReport(results)], new Map([["c", spec("c")]]), { now: NOW, minSamples: 3 });
    expect(c.fixtures[0]!.recommendation).toBe("ok");
  });
  test("custom thresholds respected", () => {
    const results = [
      makeResult({ fixtureId: "d", solved: true }),
      makeResult({ fixtureId: "d", solved: true }),
      makeResult({ fixtureId: "d", solved: false, status: "TARGET-FAIL" }),
    ];
    const c = calibrate([makeReport(results)], new Map([["d", spec("d")]]), {
      now: NOW,
      minSamples: 3,
      trivialThreshold: 0.6,
    });
    expect(c.fixtures[0]!.recommendation).toBe("trivial");
  });
});

describe("calibrate signal hygiene", () => {
  test("results with ai.invoked=false are excluded (dry-run leak)", () => {
    const dryRun = makeResult({ fixtureId: "h", solved: true, ai: { ...makeResult().ai, invoked: false } });
    const real = [
      makeResult({ fixtureId: "h", solved: false, status: "TARGET-FAIL", ai: { ...makeResult().ai, invoked: true } }),
      makeResult({ fixtureId: "h", solved: false, status: "TARGET-FAIL", ai: { ...makeResult().ai, invoked: true } }),
      makeResult({ fixtureId: "h", solved: false, status: "TARGET-FAIL", ai: { ...makeResult().ai, invoked: true } }),
    ];
    const c = calibrate([makeReport([dryRun, ...real])], new Map([["h", spec("h")]]), { now: NOW, minSamples: 3 });
    expect(c.fixtures[0]!.total).toBe(3);
    expect(c.fixtures[0]!.solved).toBe(0);
    expect(c.fixtures[0]!.recommendation).toBe("harder");
  });
});

describe("calibrate meta-fixture handling", () => {
  test("excludeFromCalibration=true → recommendation=meta regardless of solveRate", () => {
    const results = [
      makeResult({ fixtureId: "m", solved: false, status: "TIMEOUT", ai: { ...makeResult().ai, invoked: true } }),
      makeResult({ fixtureId: "m", solved: false, status: "TIMEOUT", ai: { ...makeResult().ai, invoked: true } }),
      makeResult({ fixtureId: "m", solved: false, status: "TIMEOUT", ai: { ...makeResult().ai, invoked: true } }),
    ];
    const c = calibrate(
      [makeReport(results)],
      new Map([["m", spec("m", { excludeFromCalibration: true })]]),
      { now: NOW, minSamples: 3 },
    );
    expect(c.fixtures[0]!.recommendation).toBe("meta");
    expect(c.fixtures[0]!.reason).toContain("self-test");
  });
  test("meta fixtures appear in formatter output sections", () => {
    const results = [
      makeResult({ fixtureId: "m", solved: false, status: "TIMEOUT", ai: { ...makeResult().ai, invoked: true } }),
      makeResult({ fixtureId: "m", solved: false, status: "TIMEOUT", ai: { ...makeResult().ai, invoked: true } }),
      makeResult({ fixtureId: "m", solved: false, status: "TIMEOUT", ai: { ...makeResult().ai, invoked: true } }),
    ];
    const c = calibrate(
      [makeReport(results)],
      new Map([["m", spec("m", { excludeFromCalibration: true })]]),
      { now: NOW, minSamples: 3 },
    );
    expect(formatCalibrationText(c)).toContain("Harness self-tests");
    expect(formatCalibrationMd(c)).toContain("Harness self-tests");
  });
});

describe("calibrate min-samples gate", () => {
  test("below minSamples → insufficient regardless of solveRate", () => {
    const results = [makeResult({ fixtureId: "x", solved: true }), makeResult({ fixtureId: "x", solved: true })];
    const c = calibrate([makeReport(results)], new Map([["x", spec("x")]]), { now: NOW, minSamples: 3 });
    expect(c.fixtures[0]!.recommendation).toBe("insufficient");
  });
});

describe("calibrate spec enrichment + averages", () => {
  test("avgTurns + avgCostUsd computed when present", () => {
    const results = [
      makeResult({ fixtureId: "e", ai: { ...makeResult().ai, numTurns: 4, totalCostUsd: 0.10 } }),
      makeResult({ fixtureId: "e", ai: { ...makeResult().ai, numTurns: 6, totalCostUsd: 0.20 } }),
      makeResult({ fixtureId: "e", ai: { ...makeResult().ai, numTurns: 8, totalCostUsd: 0.30 } }),
    ];
    const c = calibrate([makeReport(results)], new Map([["e", spec("e", { difficulty: "easy" })]]), { now: NOW, minSamples: 3 });
    const f = c.fixtures[0]!;
    expect(f.avgTurns).toBeCloseTo(6);
    expect(f.avgCostUsd).toBeCloseTo(0.20);
    expect(f.difficulty).toBe("easy");
    expect(f.title).toBe("Title e");
  });
  test("missing turn/cost data → null averages", () => {
    const c = calibrate(
      [makeReport([makeResult({ fixtureId: "f" }), makeResult({ fixtureId: "f" }), makeResult({ fixtureId: "f" })])],
      new Map(),
      { now: NOW, minSamples: 3 },
    );
    expect(c.fixtures[0]!.avgTurns).toBeNull();
    expect(c.fixtures[0]!.avgCostUsd).toBeNull();
    expect(c.fixtures[0]!.difficulty).toBe("(unknown)");
  });
});

describe("calibrate formatters", () => {
  const reps = [
    makeReport([
      ...Array.from({ length: 5 }, () => makeResult({ fixtureId: "a-easy", solved: true })),
      ...Array.from({ length: 4 }, () => makeResult({ fixtureId: "b-hard", solved: false, status: "TARGET-FAIL" })),
      makeResult({ fixtureId: "b-hard", solved: true }),
    ]),
  ];
  const specs = new Map<string, BenchSpec>([
    ["a-easy", spec("a-easy", { difficulty: "easy" })],
    ["b-hard", spec("b-hard", { difficulty: "hard" })],
  ]);
  test("text format includes header + buckets + table", () => {
    const c = calibrate(reps, specs, { now: NOW, minSamples: 3 });
    const out = formatCalibrationText(c);
    expect(out).toContain("Benchmark calibration");
    expect(out).toContain("Promote / retire");
    expect(out).toContain("Investigate / harden");
    expect(out).toContain("a-easy");
    expect(out).toContain("b-hard");
  });
  test("md format produces tables and sections", () => {
    const c = calibrate(reps, specs, { now: NOW, minSamples: 3 });
    const out = formatCalibrationMd(c);
    expect(out).toContain("# Benchmark calibration");
    expect(out).toContain("## Promote / retire");
    expect(out).toContain("## Investigate / harden");
    expect(out).toContain("| fixture | difficulty |");
  });
});
