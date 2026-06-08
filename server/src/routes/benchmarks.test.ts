import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { buildApp } from "../app";
import { buildBenchArgs } from "./benchmarks";

describe("buildBenchArgs", () => {
  const known = new Set(["01-foo", "02-bar"]);

  test("base args + filters unknown fixtures", () => {
    const r = buildBenchArgs({ fixtures: ["01-foo", "ZZ-unknown", 42] }, known);
    expect(r.args).toEqual(["run", "bench", "--fixture=01-foo"]);
    expect(r.fixtures).toEqual(["01-foo"]);
  });

  test("mock + lenient + mockClaude", () => {
    const r = buildBenchArgs({ mock: true, lenient: true, mockClaude: true }, known);
    expect(r.args).toEqual(["run", "bench", "--mock", "--mock-claude", "--lenient"]);
  });

  test("mode=pipeline appended", () => {
    const r = buildBenchArgs({ mode: "pipeline" }, known);
    expect(r.args).toContain("--mode=pipeline");
  });

  test("mode=harness or invalid mode is omitted", () => {
    expect(buildBenchArgs({ mode: "harness" }, known).args).not.toContain("--mode=harness");
    expect(buildBenchArgs({ mode: "junk" as unknown as "pipeline" }, known).args).not.toContain(
      "--mode=junk",
    );
  });

  test("parallel within bounds is appended", () => {
    expect(buildBenchArgs({ parallel: 2 }, known).args).toContain("--parallel=2");
  });

  test("parallel out of bounds or non-integer is dropped", () => {
    expect(
      buildBenchArgs({ parallel: 0 }, known).args.some((a) => a.startsWith("--parallel")),
    ).toBe(false);
    expect(
      buildBenchArgs({ parallel: 5 }, known).args.some((a) => a.startsWith("--parallel")),
    ).toBe(false);
    expect(
      buildBenchArgs({ parallel: 1.5 }, known).args.some((a) => a.startsWith("--parallel")),
    ).toBe(false);
    expect(
      buildBenchArgs({ parallel: "2" as unknown as number }, known).args.some((a) =>
        a.startsWith("--parallel"),
      ),
    ).toBe(false);
  });

  test("non-string fixture entries are filtered without throwing", () => {
    const r = buildBenchArgs({ fixtures: [null, undefined, {}, "01-foo"] as unknown[] }, known);
    expect(r.fixtures).toEqual(["01-foo"]);
  });

  test("falsy/missing body yields plain args", () => {
    expect(buildBenchArgs({}, known).args).toEqual(["run", "bench"]);
  });
});

let app: Awaited<ReturnType<typeof buildApp>>;
let tmpBench: string;
const reportId = "2099-01-01T00-00-00-000Z";

beforeAll(async () => {
  tmpBench = fs.mkdtempSync(path.join(os.tmpdir(), "bench-route-"));
  fs.mkdirSync(path.join(tmpBench, "results"), { recursive: true });
  fs.mkdirSync(path.join(tmpBench, "fixtures", "01-test-fixture"), { recursive: true });

  fs.writeFileSync(
    path.join(tmpBench, "fixtures", "01-test-fixture", "bench.json"),
    JSON.stringify({
      id: "01-test-fixture",
      title: "Test fixture",
      category: "bug-fix",
      difficulty: "easy",
      prompt: "fix it",
      targetTestPath: "tests/target.test.ts",
      regressionTestPath: "tests/regression.test.ts",
      maxDiffLines: 10,
      timeoutMs: 60000,
    }),
  );

  fs.writeFileSync(
    path.join(tmpBench, "results", `${reportId}.json`),
    JSON.stringify({
      startedAt: "2099-01-01T00:00:00.000Z",
      finishedAt: "2099-01-01T00:00:01.000Z",
      totalMs: 1000,
      count: 1,
      solvedCount: 1,
      results: [
        {
          fixtureId: "01-test-fixture",
          title: "Test fixture",
          runId: "abc",
          startedAt: "2099-01-01T00:00:00.000Z",
          durationMs: 1000,
          status: "SOLVED",
          solved: true,
          ai: {
            totalCostUsd: 0.05,
            models: ["claude-test-1"],
            invoked: true,
            exitCode: 0,
            durationMs: 100,
            durationApiMs: null,
            summary: null,
            sessionId: null,
            numTurns: 1,
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
            filesChanged: ["src/foo.ts"],
            linesAdded: 1,
            linesRemoved: 1,
            withinBudget: true,
            expectedFilesOnly: true,
          },
          preflight: { ran: false, misFixture: false, reason: null },
          tampering: { checked: false, detected: false, changedFiles: [] },
          chain: {
            depth: 0,
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
            embeddings: { rowCount: 0, skipped: true },
            allGreen: false,
          },
          error: null,
        },
      ],
    }),
  );

  fs.writeFileSync(path.join(tmpBench, "results", "malformed.json"), "{ not json");

  process.env.VK_BENCH_DIR = tmpBench;
  process.env.VK_DISABLE_BENCH_SPAWN = "1";

  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  delete process.env.VK_BENCH_DIR;
  delete process.env.VK_DISABLE_BENCH_SPAWN;
  fs.rmSync(tmpBench, { recursive: true, force: true });
});

describe("benchmarks routes", () => {
  test("GET /api/benchmarks/runs lists reports newest-first and skips malformed", async () => {
    const res = await app.inject({ method: "GET", url: "/api/benchmarks/runs" });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { runs: { id: string; totalCostUsd: number; models: string[] }[] };
    expect(j.runs.length).toBe(1);
    expect(j.runs[0].id).toBe(reportId);
    expect(j.runs[0].totalCostUsd).toBeCloseTo(0.05, 5);
    expect(j.runs[0].models).toEqual(["claude-test-1"]);
  });

  test("GET /api/benchmarks/runs/:id returns full report", async () => {
    const res = await app.inject({ method: "GET", url: `/api/benchmarks/runs/${reportId}` });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { results: { fixtureId: string }[] };
    expect(j.results.length).toBe(1);
    expect(j.results[0].fixtureId).toBe("01-test-fixture");
  });

  test("GET /api/benchmarks/runs/:id rejects bad id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/benchmarks/runs/..%2Fetc%2Fpasswd" });
    expect(res.statusCode).toBe(400);
  });

  test("GET /api/benchmarks/runs/:id 404 for unknown id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/benchmarks/runs/does-not-exist" });
    expect(res.statusCode).toBe(404);
  });

  test("GET /api/benchmarks/fixtures lists fixture catalog", async () => {
    const res = await app.inject({ method: "GET", url: "/api/benchmarks/fixtures" });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { fixtures: { id: string; difficulty: string }[] };
    expect(j.fixtures.length).toBe(1);
    expect(j.fixtures[0].id).toBe("01-test-fixture");
    expect(j.fixtures[0].difficulty).toBe("easy");
  });

  test("GET /api/benchmarks/aggregate runs in-process", async () => {
    const res = await app.inject({ method: "GET", url: "/api/benchmarks/aggregate" });
    expect(res.statusCode).toBe(200);
    const j = res.json() as {
      reportsScanned: number;
      resultsScanned: number;
      byFixture: { key: string }[];
    };
    expect(j.reportsScanned).toBe(1);
    expect(j.resultsScanned).toBe(1);
    expect(j.byFixture.find((b) => b.key === "01-test-fixture")).toBeDefined();
  });

  test("POST /api/benchmarks/runs validates fixtures + skips spawn when VK_DISABLE_BENCH_SPAWN=1", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/benchmarks/runs",
      headers: { "Content-Type": "application/json" },
      payload: { fixtures: ["01-test-fixture", "junk"], mock: true, parallel: 2 },
    });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { runId: string; args: string[]; fixtures: string[]; spawned: boolean };
    expect(j.runId).toMatch(/^[a-f0-9]+$/);
    expect(j.fixtures).toEqual(["01-test-fixture"]);
    expect(j.args).toEqual(["run", "bench", "--fixture=01-test-fixture", "--mock", "--parallel=2"]);
    expect(j.spawned).toBe(false);
  });

  test("GET /api/benchmarks/active reflects the just-triggered run", async () => {
    const res = await app.inject({ method: "GET", url: "/api/benchmarks/active" });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { runs: { runId: string; status: string }[] };
    expect(j.runs.length).toBeGreaterThanOrEqual(1);
    expect(j.runs.some((r) => r.status === "done")).toBe(true);
  });
});

describe("GET /api/benchmarks/drift", () => {
  test("returns zeros when replays/ does not exist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/benchmarks/drift" });
    expect(res.statusCode).toBe(200);
    const j = res.json() as {
      totalCaptures: number;
      projectCount: number;
      latestCaptureAt: string | null;
      byProject: unknown[];
    };
    expect(j.totalCaptures).toBe(0);
    expect(j.projectCount).toBe(0);
    expect(j.latestCaptureAt).toBeNull();
    expect(j.byProject).toEqual([]);
  });

  test("aggregates sidecar JSONs by project hash and sorts by lastAt desc", async () => {
    const replaysDir = path.join(tmpBench, "replays");
    fs.mkdirSync(replaysDir, { recursive: true });
    const write = (
      slug: string,
      hash: string,
      capturedAt: string,
      exitCode: number | null,
    ): void => {
      fs.writeFileSync(
        path.join(replaysDir, `${slug}.json`),
        JSON.stringify({
          schemaVersion: 1,
          capturedAt,
          runId: slug,
          taskId: "t",
          projectId: "p",
          payload: { project: { nameHash: hash } },
          outcome: { exitCode, durationMs: 1, summary: null, sessionId: null },
          workdirArchive: `${slug}.tar.gz`,
        }),
      );
    };
    write("a", "hash-aaaa", "2099-01-01T00:00:00.000Z", 0);
    write("b", "hash-aaaa", "2099-01-02T00:00:00.000Z", 1);
    write("c", "hash-bbbb", "2099-01-03T00:00:00.000Z", 0);
    fs.writeFileSync(path.join(replaysDir, "broken.json"), "{ not json");
    fs.writeFileSync(path.join(replaysDir, "ignore.txt"), "ignored");

    try {
      const res = await app.inject({ method: "GET", url: "/api/benchmarks/drift" });
      expect(res.statusCode).toBe(200);
      const j = res.json() as {
        totalCaptures: number;
        projectCount: number;
        latestCaptureAt: string | null;
        byProject: { hash: string; count: number; lastAt: string; lastExitCode: number | null }[];
      };
      expect(j.totalCaptures).toBe(3);
      expect(j.projectCount).toBe(2);
      expect(j.latestCaptureAt).toBe("2099-01-03T00:00:00.000Z");
      expect(j.byProject[0].hash).toBe("hash-bbbb");
      expect(j.byProject[1].hash).toBe("hash-aaaa");
      expect(j.byProject[1].count).toBe(2);
      expect(j.byProject[1].lastExitCode).toBe(1);
    } finally {
      fs.rmSync(replaysDir, { recursive: true, force: true });
    }
  });
});

describe("GET /api/benchmarks/runs/:id/events (SSE)", () => {
  test("rejects bad id with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/benchmarks/runs/..%2Fetc%2Fpasswd/events",
    });
    expect(res.statusCode).toBe(400);
  });

  test("404 for unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/benchmarks/runs/no-such-run/events",
    });
    expect(res.statusCode).toBe(404);
  });

  test("finished run replays + emits terminal status, then closes", async () => {
    const trigger = await app.inject({
      method: "POST",
      url: "/api/benchmarks/runs",
      headers: { "Content-Type": "application/json" },
      payload: { fixtures: ["01-test-fixture"], mock: true },
    });
    const { runId } = trigger.json() as { runId: string };

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${address}/api/benchmarks/runs/${runId}/events`, {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");

    let body = "";
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) body += dec.decode(value);
    }
    clearTimeout(timer);

    expect(body).toContain("event: status");
    expect(body).toContain('"status":"done"');
  });
});
