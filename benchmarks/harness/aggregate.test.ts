import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  aggregate,
  compareReports,
  computeOverBudget,
  formatAggregateMd,
  formatCompareMd,
  groupByFixture,
  groupByModel,
  groupByWeek,
  isoWeek,
  listResultFiles,
  loadAllReports,
  loadFixtureSpecs,
  loadReport,
} from "./aggregate";
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

describe("isoWeek", () => {
  test("YYYY-Wnn format", () => {
    const w = isoWeek("2026-05-04T00:00:00.000Z");
    expect(w).toMatch(/^2026-W\d{2}$/);
  });
  test("invalid date → unknown", () => {
    expect(isoWeek("not a date")).toBe("unknown");
  });
  test("week boundary stable", () => {
    expect(isoWeek("2026-01-01T00:00:00.000Z")).toBe(isoWeek("2026-01-01T23:59:59.000Z"));
  });
});

describe("groupByFixture", () => {
  test("empty input", () => {
    expect(groupByFixture([])).toEqual([]);
  });
  test("aggregates same fixture across reports", () => {
    const r1 = makeReport([makeResult({ fixtureId: "a", solved: true })]);
    const r2 = makeReport([makeResult({ fixtureId: "a", solved: false, status: "TARGET-FAIL" })]);
    const buckets = groupByFixture([r1, r2]);
    expect(buckets.length).toBe(1);
    expect(buckets[0].key).toBe("a");
    expect(buckets[0].total).toBe(2);
    expect(buckets[0].solved).toBe(1);
    expect(buckets[0].solveRate).toBe(0.5);
  });
  test("sums totalCostUsd, ignores nulls", () => {
    const r = makeReport([
      makeResult({ ai: { ...makeResult().ai, totalCostUsd: 0.05 } }),
      makeResult({ ai: { ...makeResult().ai, totalCostUsd: null } }),
      makeResult({ ai: { ...makeResult().ai, totalCostUsd: 0.10 } }),
    ]);
    const buckets = groupByFixture([r]);
    expect(buckets[0].totalCostUsd).toBeCloseTo(0.15, 4);
  });
  test("solveRate=0 when all fail", () => {
    const r = makeReport([makeResult({ solved: false, status: "REGRESSED" })]);
    const buckets = groupByFixture([r]);
    expect(buckets[0].solveRate).toBe(0);
  });
});

describe("groupByModel", () => {
  test("dedupes per result, counts per model", () => {
    const r = makeReport([
      makeResult({ ai: { ...makeResult().ai, models: ["claude-opus-4-7"] } }),
      makeResult({ ai: { ...makeResult().ai, models: ["claude-sonnet-4-6"] }, solved: false, status: "REGRESSED" }),
    ]);
    const buckets = groupByModel([r]);
    expect(buckets.length).toBe(2);
    const opus = buckets.find((b) => b.key === "claude-opus-4-7")!;
    const sonnet = buckets.find((b) => b.key === "claude-sonnet-4-6")!;
    expect(opus.solved).toBe(1);
    expect(sonnet.solved).toBe(0);
  });
  test("missing models bucketed under (unknown)", () => {
    const r = makeReport([makeResult({ ai: { ...makeResult().ai, models: [] } })]);
    const buckets = groupByModel([r]);
    expect(buckets[0].key).toBe("(unknown)");
  });
});

describe("groupByWeek", () => {
  test("buckets by ISO week of report.startedAt", () => {
    const a = makeReport([makeResult()], "2026-05-04T00:00:00.000Z");
    const b = makeReport([makeResult()], "2026-05-11T00:00:00.000Z");
    const buckets = groupByWeek([a, b]);
    expect(buckets.length).toBe(2);
  });
});

describe("computeOverBudget", () => {
  test("flags fixture if total cost exceeds budget", () => {
    const r = makeReport([
      makeResult({ fixtureId: "x", ai: { ...makeResult().ai, totalCostUsd: 0.5 } }),
      makeResult({ fixtureId: "x", ai: { ...makeResult().ai, totalCostUsd: 0.6 } }),
    ]);
    const buckets = groupByFixture([r]);
    const specs = new Map<string, BenchSpec>([["x", { id: "x", title: "x", category: "x", difficulty: "x", prompt: "p", targetTestPath: "t", regressionTestPath: "r", maxDiffLines: 100, timeoutMs: 1000, costBudgetUsd: 1.0 }]]);
    const flagged = computeOverBudget(buckets, specs);
    expect(flagged.length).toBe(1);
    expect(flagged[0].totalCostUsd).toBeCloseTo(1.1, 4);
    expect(buckets[0].overBudget).toBe(true);
  });
  test("skips when fixture has no budget", () => {
    const r = makeReport([makeResult({ fixtureId: "y", ai: { ...makeResult().ai, totalCostUsd: 99 } })]);
    const buckets = groupByFixture([r]);
    const flagged = computeOverBudget(buckets, new Map());
    expect(flagged.length).toBe(0);
  });
  test("no flag when cost is under budget", () => {
    const r = makeReport([makeResult({ fixtureId: "z", ai: { ...makeResult().ai, totalCostUsd: 0.1 } })]);
    const buckets = groupByFixture([r]);
    const specs = new Map<string, BenchSpec>([["z", { id: "z", title: "z", category: "z", difficulty: "z", prompt: "p", targetTestPath: "t", regressionTestPath: "r", maxDiffLines: 100, timeoutMs: 1000, costBudgetUsd: 1.0 }]]);
    expect(computeOverBudget(buckets, specs).length).toBe(0);
  });
});

describe("aggregate full", () => {
  test("combines all groupings + totals", () => {
    const r = makeReport([
      makeResult({ ai: { ...makeResult().ai, totalCostUsd: 0.02, models: ["m1"] } }),
      makeResult({ fixtureId: "b", solved: false, status: "TARGET-FAIL", ai: { ...makeResult().ai, totalCostUsd: 0.03, models: ["m2"] } }),
    ]);
    const a = aggregate([r], new Map());
    expect(a.resultsScanned).toBe(2);
    expect(a.reportsScanned).toBe(1);
    expect(a.byFixture.length).toBe(2);
    expect(a.byModel.length).toBe(2);
    expect(a.totalCostUsd).toBeCloseTo(0.05, 4);
  });
});

describe("compareReports", () => {
  test("classifies regression/improvement/no-change", () => {
    const before = makeReport([
      makeResult({ fixtureId: "a", solved: true, status: "SOLVED" }),
      makeResult({ fixtureId: "b", solved: false, status: "TARGET-FAIL" }),
      makeResult({ fixtureId: "c", solved: true, status: "SOLVED" }),
    ]);
    const after = makeReport([
      makeResult({ fixtureId: "a", solved: false, status: "REGRESSED" }),
      makeResult({ fixtureId: "b", solved: true, status: "SOLVED" }),
      makeResult({ fixtureId: "c", solved: true, status: "SOLVED" }),
    ]);
    const cmp = compareReports(before, after, "/tmp/a.json", "/tmp/b.json");
    expect(cmp.regressions).toBe(1);
    expect(cmp.improvements).toBe(1);
    const aEntry = cmp.fixtures.find((f) => f.fixtureId === "a")!;
    expect(aEntry.delta).toBe("regression");
    const bEntry = cmp.fixtures.find((f) => f.fixtureId === "b")!;
    expect(bEntry.delta).toBe("improvement");
    const cEntry = cmp.fixtures.find((f) => f.fixtureId === "c")!;
    expect(cEntry.delta).toBe("no-change");
  });
  test("status-change when solved unchanged but status differs", () => {
    const before = makeReport([makeResult({ fixtureId: "a", solved: false, status: "TARGET-FAIL" })]);
    const after = makeReport([makeResult({ fixtureId: "a", solved: false, status: "REGRESSED" })]);
    const cmp = compareReports(before, after, "x", "y");
    expect(cmp.statusChanges).toBe(1);
    expect(cmp.fixtures[0].delta).toBe("status-change");
  });
  test("added/removed when fixture in only one side", () => {
    const before = makeReport([makeResult({ fixtureId: "a" })]);
    const after = makeReport([makeResult({ fixtureId: "a" }), makeResult({ fixtureId: "newone" })]);
    const cmp = compareReports(before, after, "x", "y");
    const newone = cmp.fixtures.find((f) => f.fixtureId === "newone")!;
    expect(newone.delta).toBe("added");
  });
  test("cost delta sums correctly", () => {
    const before = makeReport([makeResult({ fixtureId: "a", ai: { ...makeResult().ai, totalCostUsd: 0.10 } })]);
    const after = makeReport([makeResult({ fixtureId: "a", ai: { ...makeResult().ai, totalCostUsd: 0.30 } })]);
    const cmp = compareReports(before, after, "x", "y");
    expect(cmp.totalCostBeforeUsd).toBeCloseTo(0.10, 4);
    expect(cmp.totalCostAfterUsd).toBeCloseTo(0.30, 4);
    expect(cmp.costDeltaUsd).toBeCloseTo(0.20, 4);
    expect(cmp.fixtures[0].costDeltaUsd).toBeCloseTo(0.20, 4);
  });
});

describe("formatters render", () => {
  test("formatAggregateMd contains expected sections", () => {
    const r = makeReport([makeResult()]);
    const md = formatAggregateMd(aggregate([r], new Map()));
    expect(md).toContain("# Benchmark aggregate");
    expect(md).toContain("## by fixture");
    expect(md).toContain("## by model");
    expect(md).toContain("## by week");
  });
  test("formatCompareMd lists fixtures + summary", () => {
    const before = makeReport([makeResult({ fixtureId: "a", solved: true, status: "SOLVED" })]);
    const after = makeReport([makeResult({ fixtureId: "a", solved: false, status: "REGRESSED" })]);
    const md = formatCompareMd(compareReports(before, after, "x", "y"));
    expect(md).toContain("# Benchmark compare");
    expect(md).toContain("Regressions:");
    expect(md).toContain("a");
  });
});

describe("filesystem helpers", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-bench-agg-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("listResultFiles returns sorted .json files only", () => {
    fs.writeFileSync(path.join(tmpDir, "a.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "b.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "ignore.md"), "x");
    const files = listResultFiles(tmpDir);
    expect(files.length).toBe(2);
    expect(files[0].endsWith("a.json")).toBe(true);
    expect(files[1].endsWith("b.json")).toBe(true);
  });

  test("listResultFiles missing dir → []", () => {
    expect(listResultFiles(path.join(tmpDir, "nope"))).toEqual([]);
  });

  test("loadAllReports skips malformed json", () => {
    const r = makeReport([makeResult()]);
    fs.writeFileSync(path.join(tmpDir, "ok.json"), JSON.stringify(r));
    fs.writeFileSync(path.join(tmpDir, "bad.json"), "{not json");
    const reports = loadAllReports(tmpDir);
    expect(reports.length).toBe(1);
  });

  test("loadReport throws on missing file", () => {
    expect(() => loadReport(path.join(tmpDir, "nope.json"))).toThrow();
  });

  test("loadFixtureSpecs picks up bench.json files", () => {
    const fxDir = path.join(tmpDir, "fixtures");
    fs.mkdirSync(path.join(fxDir, "01-x"), { recursive: true });
    fs.mkdirSync(path.join(fxDir, "02-y"), { recursive: true });
    fs.writeFileSync(path.join(fxDir, "01-x", "bench.json"), JSON.stringify({ id: "01-x", title: "t", category: "c", difficulty: "easy", prompt: "p", targetTestPath: "t", regressionTestPath: "r", maxDiffLines: 100, timeoutMs: 1000 }));
    fs.writeFileSync(path.join(fxDir, "02-y", "bench.json"), JSON.stringify({ id: "02-y", title: "t", category: "c", difficulty: "easy", prompt: "p", targetTestPath: "t", regressionTestPath: "r", maxDiffLines: 100, timeoutMs: 1000 }));
    const specs = loadFixtureSpecs(fxDir);
    expect(specs.size).toBe(2);
    expect(specs.has("01-x")).toBe(true);
  });
});
