import type { FastifyPluginAsync } from "fastify";
import path from "node:path";
import fs from "node:fs";
import { aggregate, loadAllReports, loadFixtureSpecs } from "../../../benchmarks/harness/aggregate";
import * as benchRunsRepo from "../services/benchRunsRepo";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const DEFAULT_BENCH_DIR = path.join(REPO_ROOT, "benchmarks");

function benchDir(): string {
  return process.env.VK_BENCH_DIR ?? DEFAULT_BENCH_DIR;
}

function resultsDir(): string {
  return path.join(benchDir(), "results");
}

function fixturesDir(): string {
  return path.join(benchDir(), "fixtures");
}

const ID_RE = /^[A-Za-z0-9._-]+$/;
const ALLOWED_PARALLEL_MIN = 1;
const ALLOWED_PARALLEL_MAX = 4;

export interface BenchTriggerInput {
  fixtures?: unknown;
  mock?: unknown;
  mockClaude?: unknown;
  mode?: unknown;
  parallel?: unknown;
  lenient?: unknown;
}

export interface BuiltBenchArgs {
  args: string[];
  fixtures: string[];
}

export function buildBenchArgs(body: BenchTriggerInput, knownFixtureIds: Set<string>): BuiltBenchArgs {
  const args: string[] = ["run", "bench"];
  const fx = Array.isArray(body.fixtures)
    ? (body.fixtures as unknown[]).filter((v): v is string => typeof v === "string" && knownFixtureIds.has(v))
    : [];
  for (const f of fx) args.push(`--fixture=${f}`);
  if (body.mock === true) args.push("--mock");
  if (body.mockClaude === true) args.push("--mock-claude");
  if (body.lenient === true) args.push("--lenient");
  if (body.mode === "pipeline") args.push("--mode=pipeline");
  if (
    typeof body.parallel === "number"
    && Number.isInteger(body.parallel)
    && body.parallel >= ALLOWED_PARALLEL_MIN
    && body.parallel <= ALLOWED_PARALLEL_MAX
  ) {
    args.push(`--parallel=${body.parallel}`);
  }
  return { args, fixtures: fx };
}

function listReportFiles(): string[] {
  const dir = resultsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("aggregate-") && !f.startsWith("compare-") && !f.startsWith("calibrate-"))
    .sort()
    .reverse();
}

function totalCost(r: { results?: { ai?: { totalCostUsd?: number | null } }[] }): number {
  return (r.results ?? []).reduce((s, x) => s + (typeof x.ai?.totalCostUsd === "number" ? x.ai.totalCostUsd : 0), 0);
}

function uniqueModels(r: { results?: { ai?: { models?: string[] } }[] }): string[] {
  const set = new Set<string>();
  for (const x of r.results ?? []) {
    for (const m of x.ai?.models ?? []) {
      if (m) set.add(m);
    }
  }
  return [...set];
}

interface ActiveRunTransient {
  args: string[];
  pid: number | null;
  exitCode: number | null;
  output: string;
}

const transient = new Map<string, ActiveRunTransient>();
const MAX_OUTPUT_BYTES = 256 * 1024;

function statusToWire(s: benchRunsRepo.BenchRunStatus): "running" | "done" | "error" {
  if (s === "succeeded") return "done";
  if (s === "failed") return "error";
  return "running";
}

interface ActiveRunWire {
  runId: string;
  startedAt: string;
  args: string[];
  pid: number | null;
  exitCode: number | null;
  status: "running" | "done" | "error";
  output: string;
}

function toActiveWire(row: benchRunsRepo.BenchRunRow): ActiveRunWire {
  const t = transient.get(row.id);
  return {
    runId: row.id,
    startedAt: row.startedAt,
    args: t?.args ?? [],
    pid: t?.pid ?? null,
    exitCode: t?.exitCode ?? null,
    status: statusToWire(row.status),
    output: t?.output ?? "",
  };
}

const benchmarkRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/benchmarks/runs", async () => {
    const files = listReportFiles();
    const runs = files.map((f) => {
      try {
        const full = path.join(resultsDir(), f);
        const r = JSON.parse(fs.readFileSync(full, "utf-8")) as {
          startedAt?: string;
          finishedAt?: string;
          totalMs?: number;
          count?: number;
          solvedCount?: number;
          results?: { ai?: { totalCostUsd?: number | null; models?: string[] } }[];
        };
        return {
          id: f.slice(0, -".json".length),
          startedAt: r.startedAt ?? null,
          finishedAt: r.finishedAt ?? null,
          totalMs: r.totalMs ?? null,
          count: r.count ?? (r.results?.length ?? 0),
          solvedCount: r.solvedCount ?? null,
          totalCostUsd: totalCost(r),
          models: uniqueModels(r),
        };
      } catch {
        return null;
      }
    }).filter((x): x is NonNullable<typeof x> => x !== null);
    return { runs };
  });

  fastify.get("/benchmarks/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!ID_RE.test(id)) return reply.code(400).send({ error: "invalid id" });
    const file = path.join(resultsDir(), `${id}.json`);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: "not found" });
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return reply.code(500).send({ error: "malformed report" });
    }
  });

  fastify.get("/benchmarks/fixtures", async () => {
    const specs = loadFixtureSpecs(fixturesDir());
    const fixtures = [...specs.values()].map((s) => ({
      id: s.id,
      title: s.title,
      category: s.category,
      difficulty: s.difficulty,
      pipelineMode: s.pipelineMode ?? "codebase",
      expectedFilesChanged: s.expectedFilesChanged ?? [],
      maxDiffLines: s.maxDiffLines,
      timeoutMs: s.timeoutMs,
    }));
    fixtures.sort((a, b) => a.id.localeCompare(b.id));
    return { fixtures };
  });

  fastify.get("/benchmarks/aggregate", async () => {
    const reports = loadAllReports(resultsDir());
    const specs = loadFixtureSpecs(fixturesDir());
    return aggregate(reports, specs);
  });

  fastify.get("/benchmarks/active", async () => {
    const rows = benchRunsRepo.list({});
    return { runs: rows.map(toActiveWire) };
  });

  fastify.post("/benchmarks/runs", async (request, reply) => {
    const body = (request.body ?? {}) as BenchTriggerInput;
    const knownIds = new Set(loadFixtureSpecs(fixturesDir()).keys());
    const built = buildBenchArgs(body, knownIds);
    const runId = crypto.randomUUID().slice(0, 8);
    const startedAt = new Date().toISOString();
    const mode = body.mode === "pipeline" ? "pipeline" : "harness";
    const mock = body.mock === true;
    const parallel = typeof body.parallel === "number" && Number.isInteger(body.parallel) && body.parallel >= ALLOWED_PARALLEL_MIN && body.parallel <= ALLOWED_PARALLEL_MAX
      ? body.parallel
      : 1;

    benchRunsRepo.insert({
      id: runId,
      startedAt,
      fixturesCsv: built.fixtures.join(","),
      mode,
      mock,
      parallel,
    });

    const t: ActiveRunTransient = { args: built.args, pid: null, exitCode: null, output: "" };
    transient.set(runId, t);

    if (process.env.VK_DISABLE_BENCH_SPAWN === "1") {
      benchRunsRepo.updateOnFinish(runId, "succeeded", null);
      return reply.send({ runId, startedAt, args: built.args, fixtures: built.fixtures, spawned: false });
    }

    try {
      const proc = Bun.spawn(["bun", ...built.args], {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      t.pid = proc.pid;
      const append = async (stream: ReadableStream<Uint8Array> | null | undefined) => {
        if (!stream) return;
        const reader = stream.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (t.output.length < MAX_OUTPUT_BYTES) {
            t.output += dec.decode(value);
            if (t.output.length > MAX_OUTPUT_BYTES) t.output = t.output.slice(0, MAX_OUTPUT_BYTES);
          }
        }
      };
      void Promise.all([append(proc.stdout), append(proc.stderr)]);
      void proc.exited.then((code) => {
        t.exitCode = code;
        benchRunsRepo.updateOnFinish(runId, code === 0 ? "succeeded" : "failed", null);
      });
    } catch (err) {
      t.exitCode = -1;
      t.output += `\nspawn error: ${err instanceof Error ? err.message : String(err)}`;
      benchRunsRepo.updateOnFinish(runId, "failed", null);
    }

    return reply.send({ runId, startedAt, args: built.args, fixtures: built.fixtures, spawned: true });
  });
};

export default benchmarkRoutes;
