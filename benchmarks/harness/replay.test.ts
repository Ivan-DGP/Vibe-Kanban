import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  compareOutcomes,
  expandWorkdirPlaceholders,
  listReplaySidecars,
  loadReplaySidecar,
  renderReplayMarkdown,
  summarizeReplays,
  type ReplayResult,
} from "./replay";

function makeReplayResult(overrides: Partial<ReplayResult> = {}): ReplayResult {
  return {
    sidecarPath: "/tmp/sidecar.json",
    runId: "run-aaaaaaaaaa",
    taskId: "task-bbbbbbbbbb",
    projectId: "proj-ccccccc",
    workDir: "/tmp/work",
    captured: { exitCode: 0, durationMs: 1000, summary: "ok", sessionId: null },
    replay: { exitCode: 0, summary: "ok", sessionId: null, durationMs: 1100 },
    comparison: { exitCodeMatches: true, bothNonZero: false, bothZero: true },
    error: null,
    ...overrides,
  };
}

describe("expandWorkdirPlaceholders", () => {
  test("replaces every <workdir> with the given path", () => {
    expect(expandWorkdirPlaceholders("edit <workdir>/a.ts and <workdir>/b.ts", "/x/y")).toBe(
      "edit /x/y/a.ts and /x/y/b.ts",
    );
  });
  test("preserves null", () => {
    expect(expandWorkdirPlaceholders(null, "/x/y")).toBeNull();
  });
  test("returns input unchanged when no placeholder", () => {
    expect(expandWorkdirPlaceholders("hello", "/x/y")).toBe("hello");
  });
});

describe("compareOutcomes", () => {
  test("matches when both zero", () => {
    expect(compareOutcomes(0, 0)).toEqual({
      exitCodeMatches: true,
      bothNonZero: false,
      bothZero: true,
    });
  });
  test("matches when both non-zero (and equal)", () => {
    expect(compareOutcomes(2, 2)).toEqual({
      exitCodeMatches: true,
      bothNonZero: true,
      bothZero: false,
    });
  });
  test("flags drift when codes differ", () => {
    expect(compareOutcomes(0, 1).exitCodeMatches).toBe(false);
    expect(compareOutcomes(1, 0).exitCodeMatches).toBe(false);
  });
  test("replay null exit never matches", () => {
    expect(compareOutcomes(0, null).exitCodeMatches).toBe(false);
    expect(compareOutcomes(0, null).bothZero).toBe(false);
  });
});

describe("summarizeReplays", () => {
  test("counts matched / bothZero / bothNonZero / drifted / errored", () => {
    const results = [
      makeReplayResult(),
      makeReplayResult({
        captured: { exitCode: 1, durationMs: 1, summary: null, sessionId: null },
        replay: { exitCode: 1, summary: null, sessionId: null, durationMs: 1 },
        comparison: { exitCodeMatches: true, bothNonZero: true, bothZero: false },
      }),
      makeReplayResult({
        captured: { exitCode: 0, durationMs: 1, summary: null, sessionId: null },
        replay: { exitCode: 1, summary: null, sessionId: null, durationMs: 1 },
        comparison: { exitCodeMatches: false, bothNonZero: false, bothZero: false },
      }),
      makeReplayResult({
        error: "boom",
        replay: { exitCode: null, summary: null, sessionId: null, durationMs: 0 },
        comparison: { exitCodeMatches: false, bothNonZero: false, bothZero: false },
      }),
    ];
    const s = summarizeReplays(results);
    expect(s.total).toBe(4);
    expect(s.matched).toBe(2);
    expect(s.bothZero).toBe(1);
    expect(s.bothNonZero).toBe(1);
    expect(s.drifted).toBe(2);
    expect(s.errored).toBe(1);
  });
});

describe("renderReplayMarkdown", () => {
  test("emits a header, summary lines, and a per-row table", () => {
    const md = renderReplayMarkdown([makeReplayResult()]);
    expect(md).toContain("# bench replay report");
    expect(md).toContain("- total: 1");
    expect(md).toContain("- matched");
    expect(md).toContain("| runId |");
    expect(md).toContain("| run-aaaa | task-bbb");
  });
  test("renders a missing replay exit as em-dash", () => {
    const md = renderReplayMarkdown([
      makeReplayResult({
        replay: { exitCode: null, summary: null, sessionId: null, durationMs: 0 },
        comparison: { exitCodeMatches: false, bothNonZero: false, bothZero: false },
      }),
    ]);
    expect(md).toContain("| — |");
    expect(md).toContain("| ✗ |");
  });
});

describe("loadReplaySidecar / listReplaySidecars", () => {
  let tmp = "";
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vk-replay-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("loads a well-formed sidecar", () => {
    const sidecar = {
      schemaVersion: 1,
      capturedAt: "2026-05-09T01:23:45.000Z",
      runId: "abc",
      taskId: "tid",
      projectId: "pid",
      payload: {
        project: { nameHash: "deadbeef" },
        task: { title: "t", description: null, prompt: null, metadata: null },
        outcome: { summary: null },
      },
      outcome: { exitCode: 0, durationMs: 12, summary: null, sessionId: null },
      workdirArchive: "abc.tar.gz",
    };
    const file = path.join(tmp, "abc.json");
    fs.writeFileSync(file, JSON.stringify(sidecar));
    const loaded = loadReplaySidecar(file);
    expect(loaded.runId).toBe("abc");
    expect(loaded.workdirArchive).toBe("abc.tar.gz");
  });

  test("rejects sidecar missing schemaVersion", () => {
    const file = path.join(tmp, "bad.json");
    fs.writeFileSync(file, JSON.stringify({ runId: "a", taskId: "b", projectId: "c" }));
    expect(() => loadReplaySidecar(file)).toThrow(/schemaVersion/);
  });

  test("rejects sidecar missing identifiers", () => {
    const file = path.join(tmp, "bad2.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1 }));
    expect(() => loadReplaySidecar(file)).toThrow(/identifiers/);
  });

  test("rejects sidecar missing workdirArchive", () => {
    const file = path.join(tmp, "bad3.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ schemaVersion: 1, runId: "a", taskId: "b", projectId: "c" }),
    );
    expect(() => loadReplaySidecar(file)).toThrow(/workdirArchive/);
  });

  test("listReplaySidecars filters by runId substring", () => {
    fs.writeFileSync(path.join(tmp, "2026-05-09T00-00-00-aaaa.json"), "{}");
    fs.writeFileSync(path.join(tmp, "2026-05-09T00-00-01-bbbb.json"), "{}");
    fs.writeFileSync(path.join(tmp, "ignore.txt"), "x");
    const all = listReplaySidecars(tmp);
    expect(all.length).toBe(2);
    const filtered = listReplaySidecars(tmp, { runId: "aaaa" });
    expect(filtered.length).toBe(1);
    expect(filtered[0]).toContain("aaaa");
  });

  test("listReplaySidecars filters by since (date prefix)", () => {
    fs.writeFileSync(path.join(tmp, "2026-04-30T00-00-00-x.json"), "{}");
    fs.writeFileSync(path.join(tmp, "2026-05-09T00-00-00-y.json"), "{}");
    const filtered = listReplaySidecars(tmp, { since: "2026-05-01" });
    expect(filtered.length).toBe(1);
    expect(filtered[0]).toContain("2026-05-09");
  });

  test("listReplaySidecars on missing dir returns []", () => {
    expect(listReplaySidecars(path.join(tmp, "does-not-exist"))).toEqual([]);
  });
});
