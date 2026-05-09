import { describe, test, expect } from "bun:test";

import { calibrate } from "./calibrate";
import {
  REPLAY_FIXTURE_PREFIX,
  replayResultToBenchResult,
  replayResultsToBenchReport,
  replayResultsToFixtureSpecs,
  synthesizeFixtureId,
} from "./replayCalibrate";
import type { ReplayResult } from "./replay";

function makeReplay(over: Partial<ReplayResult> = {}): ReplayResult {
  return {
    sidecarPath: "/tmp/sc.json",
    runId: "r-aaaaaaaa",
    taskId: "t-bbbbbbbb",
    projectId: "p-cccccccc",
    workDir: "/tmp/work",
    projectNameHash: "deadbeef1234",
    capturedAt: "2026-05-09T00:00:00.000Z",
    taskMetadata: { type: "bench-codebase" },
    captured: { exitCode: 0, durationMs: 1000, summary: null, sessionId: null },
    replay: { exitCode: 0, summary: null, sessionId: null, durationMs: 1100 },
    comparison: { exitCodeMatches: true, bothNonZero: false, bothZero: true },
    error: null,
    ...over,
  };
}

describe("synthesizeFixtureId", () => {
  test("uses the replay-<projectNameHash> form", () => {
    expect(synthesizeFixtureId(makeReplay())).toBe(`${REPLAY_FIXTURE_PREFIX}deadbeef1234`);
  });
  test("falls back to 'unknown' when nameHash is empty", () => {
    expect(synthesizeFixtureId(makeReplay({ projectNameHash: "" }))).toBe(
      `${REPLAY_FIXTURE_PREFIX}unknown`,
    );
  });
  test("groups replays of the same project under one fixtureId", () => {
    const a = makeReplay({ runId: "r1" });
    const b = makeReplay({ runId: "r2" });
    expect(synthesizeFixtureId(a)).toBe(synthesizeFixtureId(b));
  });
});

describe("replayResultToBenchResult", () => {
  test("marks ai.invoked=true so calibrate counts the row", () => {
    const r = replayResultToBenchResult(makeReplay());
    expect(r.ai.invoked).toBe(true);
  });
  test("solved mirrors replay.exitCode === 0", () => {
    expect(replayResultToBenchResult(makeReplay()).solved).toBe(true);
    expect(
      replayResultToBenchResult(
        makeReplay({
          replay: { exitCode: 1, summary: null, sessionId: null, durationMs: 0 },
        }),
      ).solved,
    ).toBe(false);
  });
  test("status maps {0→SOLVED, non-zero→TARGET-FAIL, null→ERROR}", () => {
    expect(replayResultToBenchResult(makeReplay()).status).toBe("SOLVED");
    expect(
      replayResultToBenchResult(
        makeReplay({
          replay: { exitCode: 2, summary: null, sessionId: null, durationMs: 0 },
        }),
      ).status,
    ).toBe("TARGET-FAIL");
    expect(
      replayResultToBenchResult(
        makeReplay({
          replay: { exitCode: null, summary: null, sessionId: null, durationMs: 0 },
        }),
      ).status,
    ).toBe("ERROR");
  });
  test("fixtureId stable across replays of the same project", () => {
    const a = replayResultToBenchResult(makeReplay({ runId: "r1" }));
    const b = replayResultToBenchResult(makeReplay({ runId: "r2" }));
    expect(a.fixtureId).toBe(b.fixtureId);
  });
  test("startedAt mirrors capturedAt so calibrate window-filtering works", () => {
    const r = replayResultToBenchResult(makeReplay({ capturedAt: "2026-04-01T00:00:00.000Z" }));
    expect(r.startedAt).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("replayResultsToBenchReport", () => {
  test("aggregates count + solvedCount", () => {
    const rep = replayResultsToBenchReport([
      makeReplay({ runId: "r1" }),
      makeReplay({
        runId: "r2",
        replay: { exitCode: 1, summary: null, sessionId: null, durationMs: 0 },
        comparison: { exitCodeMatches: false, bothNonZero: false, bothZero: false },
      }),
    ]);
    expect(rep.count).toBe(2);
    expect(rep.solvedCount).toBe(1);
  });
  test("startedAt = earliest capturedAt; finishedAt = latest", () => {
    const rep = replayResultsToBenchReport([
      makeReplay({ runId: "a", capturedAt: "2026-05-01T00:00:00.000Z" }),
      makeReplay({ runId: "b", capturedAt: "2026-05-09T12:00:00.000Z" }),
      makeReplay({ runId: "c", capturedAt: "2026-05-05T00:00:00.000Z" }),
    ]);
    expect(rep.startedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(rep.finishedAt).toBe("2026-05-09T12:00:00.000Z");
  });
  test("empty input gives count=0 and a current timestamp", () => {
    const rep = replayResultsToBenchReport([]);
    expect(rep.count).toBe(0);
    expect(rep.solvedCount).toBe(0);
    expect(rep.startedAt).toBe(rep.finishedAt);
  });
});

describe("replayResultsToFixtureSpecs", () => {
  test("one spec per unique projectNameHash", () => {
    const specs = replayResultsToFixtureSpecs([
      makeReplay({ projectNameHash: "aaa" }),
      makeReplay({ projectNameHash: "aaa" }),
      makeReplay({ projectNameHash: "bbb" }),
    ]);
    expect(specs.size).toBe(2);
    expect(specs.has(`${REPLAY_FIXTURE_PREFIX}aaa`)).toBe(true);
    expect(specs.has(`${REPLAY_FIXTURE_PREFIX}bbb`)).toBe(true);
  });
  test("category encodes captured task metadata.type when present", () => {
    const specs = replayResultsToFixtureSpecs([makeReplay({ taskMetadata: { type: "qa-test" } })]);
    const spec = specs.get(`${REPLAY_FIXTURE_PREFIX}deadbeef1234`)!;
    expect(spec.category).toBe("replay/qa-test");
  });
  test("category falls back to 'replay' when metadata is null", () => {
    const specs = replayResultsToFixtureSpecs([makeReplay({ taskMetadata: null })]);
    const spec = specs.get(`${REPLAY_FIXTURE_PREFIX}deadbeef1234`)!;
    expect(spec.category).toBe("replay");
  });
  test("excludeFromCalibration is unset (replays should be graded)", () => {
    const specs = replayResultsToFixtureSpecs([makeReplay()]);
    const spec = specs.get(`${REPLAY_FIXTURE_PREFIX}deadbeef1234`)!;
    expect(spec.excludeFromCalibration).toBeUndefined();
  });
});

describe("calibrate consumes synthetic replay reports", () => {
  test("solve-rate computed across same-project replays", () => {
    // Three replays for project AAA in the calibration window: 1 solved, 2
    // failed → 33%. With harderThreshold=0.5 the row buckets as "harder" — we
    // raise the threshold here to make the test's intent (synthetic flow
    // plumbs through to the recommendation logic) independent of the default
    // 0.2 threshold tuned for the on-disk fixtures.
    const replays = [
      makeReplay({
        runId: "r1",
        projectNameHash: "AAA",
        capturedAt: "2026-05-01T00:00:00.000Z",
      }),
      makeReplay({
        runId: "r2",
        projectNameHash: "AAA",
        capturedAt: "2026-05-02T00:00:00.000Z",
        replay: { exitCode: 1, summary: null, sessionId: null, durationMs: 0 },
      }),
      makeReplay({
        runId: "r3",
        projectNameHash: "AAA",
        capturedAt: "2026-05-03T00:00:00.000Z",
        replay: { exitCode: 1, summary: null, sessionId: null, durationMs: 0 },
      }),
    ];
    const report = replayResultsToBenchReport(replays);
    const specs = replayResultsToFixtureSpecs(replays);
    const cal = calibrate([report], specs, {
      now: new Date("2026-05-09T00:00:00.000Z"),
      windowDays: 30,
      minSamples: 3,
      harderThreshold: 0.5,
    });
    const entry = cal.fixtures.find((f) => f.fixtureId === `${REPLAY_FIXTURE_PREFIX}AAA`)!;
    expect(entry).toBeDefined();
    expect(entry.total).toBe(3);
    expect(entry.solved).toBe(1);
    expect(entry.solveRate).toBeCloseTo(1 / 3, 5);
    expect(entry.recommendation).toBe("harder");
  });

  test("insufficient samples bucket when fewer than minSamples", () => {
    const replays = [makeReplay({ projectNameHash: "BBB" })];
    const report = replayResultsToBenchReport(replays);
    const specs = replayResultsToFixtureSpecs(replays);
    const cal = calibrate([report], specs, {
      now: new Date("2026-05-09T00:00:00.000Z"),
      minSamples: 3,
    });
    const entry = cal.fixtures.find((f) => f.fixtureId === `${REPLAY_FIXTURE_PREFIX}BBB`)!;
    expect(entry.recommendation).toBe("insufficient");
  });

  test("trivial bucket fires when all replays solved (≥ trivialThreshold)", () => {
    const replays = Array.from({ length: 5 }, (_, i) =>
      makeReplay({
        runId: `r${i}`,
        projectNameHash: "CCC",
        capturedAt: `2026-05-0${i + 1}T00:00:00.000Z`,
      }),
    );
    const report = replayResultsToBenchReport(replays);
    const specs = replayResultsToFixtureSpecs(replays);
    const cal = calibrate([report], specs, {
      now: new Date("2026-05-09T00:00:00.000Z"),
      minSamples: 3,
    });
    const entry = cal.fixtures.find((f) => f.fixtureId === `${REPLAY_FIXTURE_PREFIX}CCC`)!;
    expect(entry.solveRate).toBe(1);
    expect(entry.recommendation).toBe("trivial");
  });
});
