/**
 * Phase L4: adapter that lets `bench:calibrate` ingest replay results.
 *
 * `calibrate()` consumes `BenchReport[]` (each with `BenchResult[]`) keyed by
 * a stable `fixtureId`. Replays don't have a fixtureId — each comes from an
 * arbitrary user task — so we synthesize one per anonymized project
 * (`replay-<projectNameHash>`). All replays of the same project then form one
 * "fixture" whose solve-rate over the calibration window flags drift.
 *
 * Success metric: `replay.exitCode === 0`. The calibrator interprets that as
 * "this fixture is currently solvable"; a slide downward over time is the
 * drift signal that motivated Phase L.
 */

import type { BenchReport, BenchResult, BenchSpec, BenchE2EResult, BenchStatus } from "./types";
import type { ReplayResult } from "./replay";

export const REPLAY_FIXTURE_PREFIX = "replay-";

export function synthesizeFixtureId(replay: ReplayResult): string {
  const hash = replay.projectNameHash || "unknown";
  return `${REPLAY_FIXTURE_PREFIX}${hash}`;
}

function inferCategory(replay: ReplayResult): string {
  const md = replay.taskMetadata;
  if (md && typeof md === "object" && "type" in md && typeof md.type === "string") {
    return `replay/${md.type}`;
  }
  return "replay";
}

function statusFromReplay(replay: ReplayResult): BenchStatus {
  if (replay.error) return "ERROR";
  if (replay.replay.exitCode === null) return "ERROR";
  return replay.replay.exitCode === 0 ? "SOLVED" : "TARGET-FAIL";
}

/**
 * Build a minimal but type-complete BenchResult from a ReplayResult. Only the
 * fields `calibrate()` reads carry meaningful values; everything else is a
 * benign default that won't poison any downstream consumer.
 */
export function replayResultToBenchResult(replay: ReplayResult): BenchResult {
  const fixtureId = synthesizeFixtureId(replay);
  return {
    fixtureId,
    title: `replay ${replay.runId.slice(0, 8)}`,
    runId: replay.runId,
    startedAt: replay.capturedAt,
    durationMs: replay.replay.durationMs,
    workDir: replay.workDir,
    ai: {
      invoked: true,
      exitCode: replay.replay.exitCode,
      durationMs: replay.replay.durationMs,
      durationApiMs: null,
      summary: replay.replay.summary,
      sessionId: replay.replay.sessionId,
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
      targetPassed: replay.replay.exitCode === 0,
      regressionsHeld: replay.replay.exitCode === 0,
      targetExitCode: replay.replay.exitCode,
      regressionExitCode: null,
      targetOutput: "",
      regressionOutput: "",
    },
    diff: {
      filesChanged: [],
      linesAdded: 0,
      linesRemoved: 0,
      withinBudget: true,
      expectedFilesOnly: true,
    },
    preflight: { ran: false, misFixture: false, reason: null },
    tampering: { checked: false, detected: false, changedFiles: [] },
    chain: {
      depth: 1,
      parentLinksValid: true,
      leafTaskId: replay.taskId,
      leafStatus: null,
      totalAiRuns: 1,
      totalDurationMs: replay.replay.durationMs,
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
        found: replay.replay.exitCode !== null,
        exitCode: replay.replay.exitCode,
        success: replay.replay.exitCode === 0 ? 1 : 0,
        durationMs: replay.replay.durationMs,
        sessionIdSet: replay.replay.sessionId !== null,
        summarySet: replay.replay.summary !== null,
      },
      timestamps: {
        inboxAtSet: false,
        inProgressAtSet: false,
        doneAtSet: false,
        cascadeOrdered: false,
      },
      snapshot: { fileExists: false, taskInSnapshot: false },
      embeddings: { rowCount: 0, skipped: true },
      allGreen: false,
    },
    multiFile: { checked: false, required: [], missing: [], trivial: [], allTouched: true },
    serverIntegration: { ran: false, steps: [], allPassed: false },
    injection: {
      requested: false,
      modes: [],
      mcp500Count: 0,
      surfaced: false,
      slotLeaked: false,
      rowRecorded: false,
      recovered: false,
      notes: [],
    },
    adversarial: {
      checked: false,
      decoyMatches: [],
      injectionMatches: [],
      exfilDetected: false,
      promptInjected: false,
    },
    status: statusFromReplay(replay),
    solved: replay.replay.exitCode === 0,
    error: replay.error,
  };
}

/**
 * Group a batch of replays into a single synthetic BenchReport. Uses the
 * earliest captured-at as `startedAt` and the latest as `finishedAt` so the
 * report falls inside the calibrate window when it should.
 */
export function replayResultsToBenchReport(replays: ReplayResult[]): BenchReport {
  const results = replays.map(replayResultToBenchResult);
  const stamps = replays.map((r) => Date.parse(r.capturedAt)).filter((n) => Number.isFinite(n));
  const startedAt =
    stamps.length === 0 ? new Date().toISOString() : new Date(Math.min(...stamps)).toISOString();
  const finishedAt = stamps.length === 0 ? startedAt : new Date(Math.max(...stamps)).toISOString();
  const totalMs = Date.parse(finishedAt) - Date.parse(startedAt);
  const solvedCount = results.filter((r) => r.solved).length;
  const e2e: BenchE2EResult | undefined = undefined;
  return {
    startedAt,
    finishedAt,
    totalMs: Number.isFinite(totalMs) ? totalMs : 0,
    count: results.length,
    solvedCount,
    results,
    e2e,
  };
}

/**
 * Synthesize fixture specs for replay-derived fixtures so calibrate can label
 * the rows. One spec per unique projectNameHash. `excludeFromCalibration` is
 * NOT set — we want these to be graded.
 */
export function replayResultsToFixtureSpecs(replays: ReplayResult[]): Map<string, BenchSpec> {
  const out = new Map<string, BenchSpec>();
  for (const r of replays) {
    const id = synthesizeFixtureId(r);
    if (out.has(id)) continue;
    out.set(id, {
      id,
      title: `Replay drift — ${r.projectNameHash.slice(0, 8)}`,
      category: inferCategory(r),
      difficulty: "replay",
      prompt: "(replay — captured prompt anonymized in sidecar)",
      targetTestPath: "",
      regressionTestPath: "",
      maxDiffLines: 0,
      timeoutMs: 0,
    });
  }
  return out;
}
