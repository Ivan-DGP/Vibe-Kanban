#!/usr/bin/env bun
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { copyDirSync, hashDir, compareDirHashes, evaluateStatus, parseClaudeJson } from "./run";
import { parseNumstat } from "./score";
import {
  verifyTaskAiRun,
  verifyTimestampCascade,
  verifySnapshot,
  verifyEmbeddings,
  summarize,
} from "./sideEffects";
import { buildInjectionEnv, listInjectionModes, classifyFromResult } from "./inject";
import { runAdversarialChecks } from "./adversarial";
import type { BenchSpec, BenchResult, BenchHttpStep } from "./types";

const HARNESS_DIR = path.resolve(import.meta.dir);
const BENCH_ROOT = path.resolve(HARNESS_DIR, "..");
const FIXTURES_DIR = path.join(BENCH_ROOT, "fixtures");

interface PipelineCliOpts {
  fixtureId: string;
  mockClaude: boolean;
  realClaude: boolean;
  lenient: boolean;
  keepWorkdir: boolean;
  resultFile: string | null;
}

function parseArgs(argv: string[]): PipelineCliOpts {
  const opts: PipelineCliOpts = {
    fixtureId: "",
    mockClaude: true,
    realClaude: false,
    lenient: false,
    keepWorkdir: false,
    resultFile: null,
  };
  for (const a of argv) {
    if (a.startsWith("--fixture=")) opts.fixtureId = a.slice("--fixture=".length);
    else if (a === "--real-claude") {
      opts.realClaude = true;
      opts.mockClaude = false;
    } else if (a === "--mock-claude") opts.mockClaude = true;
    else if (a === "--lenient") opts.lenient = true;
    else if (a === "--keep") opts.keepWorkdir = true;
    else if (a.startsWith("--result-file=")) opts.resultFile = a.slice("--result-file=".length);
  }
  return opts;
}

function loadSpec(fixtureId: string): BenchSpec {
  const specPath = path.join(FIXTURES_DIR, fixtureId, "bench.json");
  return JSON.parse(fs.readFileSync(specPath, "utf-8")) as BenchSpec;
}

export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export function setupShim(
  shimDir: string,
  fakeClaudePath: string,
  apiUrl?: string,
  extraEnv?: Record<string, string>,
): void {
  fs.mkdirSync(shimDir, { recursive: true });
  const claudePath = path.join(shimDir, "claude");
  const exports: string[] = [];
  if (apiUrl) exports.push(`export VK_BENCH_API_URL=${JSON.stringify(apiUrl)}`);
  for (const [k, v] of Object.entries(extraEnv ?? {})) {
    exports.push(`export ${k}=${JSON.stringify(v)}`);
  }
  const exportBlock = exports.length > 0 ? exports.join("\n") + "\n" : "";
  const wrapper = `#!/usr/bin/env bash\n${exportBlock}exec bun ${JSON.stringify(fakeClaudePath)} "$@"\n`;
  fs.writeFileSync(claudePath, wrapper);
  fs.chmodSync(claudePath, 0o755);
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCmd(cmd: string[], cwd: string, timeoutMs?: number): Promise<SpawnResult> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
  const timer = timeoutMs ? setTimeout(() => proc.kill(), timeoutMs) : null;
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  return { stdout, stderr, exitCode };
}

async function gitInit(workDir: string): Promise<void> {
  await runCmd(["git", "init", "-q"], workDir);
  await runCmd(["git", "config", "user.name", "bench"], workDir);
  await runCmd(["git", "config", "user.email", "bench@local"], workDir);
  await runCmd(["git", "add", "-A"], workDir);
  await runCmd(["git", "commit", "-q", "-m", "baseline"], workDir);
}

async function pollForTaskAiRun(
  getDb: () => any,
  taskId: string,
  timeoutMs: number,
): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = getDb()
      .prepare("SELECT * FROM task_ai_runs WHERE taskId = ? ORDER BY createdAt DESC LIMIT 1")
      .get(taskId);
    if (row) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

function makeEmptyResult(
  spec: BenchSpec,
  runId: string,
  startedAtIso: string,
  workDir: string,
): BenchResult {
  return {
    fixtureId: spec.id,
    title: spec.title,
    runId,
    startedAt: startedAtIso,
    durationMs: 0,
    workDir,
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
      targetPassed: false,
      regressionsHeld: false,
      targetExitCode: null,
      regressionExitCode: null,
      targetOutput: "",
      regressionOutput: "",
    },
    diff: {
      filesChanged: [],
      linesAdded: 0,
      linesRemoved: 0,
      withinBudget: false,
      expectedFilesOnly: false,
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
      expectedDepth: spec.expectedChainDepth ?? null,
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
      required: spec.requireFiles ?? [],
      missing: [],
      trivial: [],
      allTouched: true,
    },
    serverIntegration: {
      ran: false,
      steps: [],
      allPassed: false,
    },
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
    status: "ERROR",
    solved: false,
    error: null,
  };
}

interface ChainTrace {
  depth: number;
  parentLinksValid: boolean;
  leafTaskId: string | null;
  leafStatus: string | null;
  taskIds: string[];
  totalAiRuns: number;
  totalDurationMs: number;
  totalCostUsd: number;
}

function selectChildTask(getDb: () => any, projectId: string, parentId: string): any | null {
  return (
    getDb()
      .prepare(
        "SELECT * FROM tasks WHERE projectId = ? AND json_extract(metadata, '$.parent_task') = ? ORDER BY createdAt ASC LIMIT 1",
      )
      .get(projectId, parentId) ?? null
  );
}

export async function traceChain(
  getDb: () => any,
  rootTaskId: string,
  projectId: string,
  settleMs: number,
  maxDepth = 5,
): Promise<ChainTrace> {
  const trace: ChainTrace = {
    depth: 1,
    parentLinksValid: true,
    leafTaskId: rootTaskId,
    leafStatus: null,
    taskIds: [rootTaskId],
    totalAiRuns: 0,
    totalDurationMs: 0,
    totalCostUsd: 0,
  };
  let cur = rootTaskId;
  for (let i = 0; i < maxDepth - 1; i++) {
    let child = selectChildTask(getDb, projectId, cur);
    if (!child) {
      const settleDeadline = Date.now() + Math.min(2000, settleMs);
      while (!child && Date.now() < settleDeadline) {
        await new Promise((r) => setTimeout(r, 100));
        child = selectChildTask(getDb, projectId, cur);
      }
    }
    if (!child) break;
    trace.depth++;
    trace.taskIds.push(child.id);
    cur = child.id;
    await pollForTaskAiRun(getDb, cur, settleMs);
  }
  trace.leafTaskId = cur;
  const leafTask = getDb().prepare("SELECT status FROM tasks WHERE id = ?").get(cur);
  trace.leafStatus = leafTask?.status ?? null;
  for (const tid of trace.taskIds) {
    const runs = getDb()
      .prepare("SELECT durationMs, summary FROM task_ai_runs WHERE taskId = ?")
      .all(tid) as Array<{ durationMs: number; summary: string | null }>;
    trace.totalAiRuns += runs.length;
    for (const r of runs) {
      trace.totalDurationMs += r.durationMs ?? 0;
      if (r.summary) {
        const parsed = parseClaudeJson(r.summary);
        if (parsed.totalCostUsd) trace.totalCostUsd += parsed.totalCostUsd;
      }
    }
  }
  for (let i = 1; i < trace.taskIds.length; i++) {
    const row = getDb().prepare("SELECT metadata FROM tasks WHERE id = ?").get(trace.taskIds[i]);
    if (!row) {
      trace.parentLinksValid = false;
      break;
    }
    let meta: any = {};
    try {
      meta = JSON.parse(row.metadata ?? "{}");
    } catch {
      trace.parentLinksValid = false;
      break;
    }
    if (meta.parent_task !== trace.taskIds[i - 1]) {
      trace.parentLinksValid = false;
      break;
    }
  }
  return trace;
}

// Resolve `${var}` and `${var.path[0].sub}` references against a context map.
// Used by server-integration script steps so a fixture can chain GET/POST
// requests where later URLs/payloads reference earlier responses.
export function substituteVars(input: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof input === "string") {
    // Whole-string single reference preserves the raw value type so fixtures
    // can write things like { value: "${task.id}" } and still compare strings.
    const whole = input.match(/^\$\{([^}]+)\}$/);
    if (whole) {
      return readPath(ctx, whole[1].trim());
    }
    return input.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
      const value = readPath(ctx, expr.trim());
      if (value === undefined) return "";
      return typeof value === "string" ? value : JSON.stringify(value);
    });
  }
  if (Array.isArray(input)) {
    return input.map((v) => substituteVars(v, ctx));
  }
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = substituteVars(v, ctx);
    }
    return out;
  }
  return input;
}

function readPath(root: unknown, expr: string): unknown {
  // Supports a.b[0].c style. Empty path returns root.
  const tokens = expr
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((t) => t.length > 0);
  let cur: unknown = root;
  for (const t of tokens) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(t);
      cur = Number.isInteger(idx) ? cur[idx] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[t];
    } else {
      return undefined;
    }
  }
  return cur;
}

interface ScriptStepResult {
  name: string;
  method: string;
  url: string;
  statusCode: number | null;
  passed: boolean;
  error: string | null;
  body: unknown;
}

export async function runHttpScript(
  app: { inject: (req: unknown) => Promise<{ statusCode: number; body: string }> },
  steps: BenchHttpStep[],
  initialCtx: Record<string, unknown>,
): Promise<ScriptStepResult[]> {
  const results: ScriptStepResult[] = [];
  const ctx = { ...initialCtx };
  for (const step of steps) {
    const url = String(substituteVars(step.url, ctx));
    const payload = step.payload === undefined ? undefined : substituteVars(step.payload, ctx);
    const stepResult: ScriptStepResult = {
      name: step.name,
      method: step.method,
      url,
      statusCode: null,
      passed: false,
      error: null,
      body: null,
    };
    try {
      const res = await app.inject({
        method: step.method,
        url,
        payload,
      });
      stepResult.statusCode = res.statusCode;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        parsed = res.body;
      }
      stepResult.body = parsed;
      const exp = (substituteVars(step.expect ?? {}, ctx) as BenchHttpStep["expect"]) ?? {};
      if (exp.statusCode !== undefined && exp.statusCode !== res.statusCode) {
        stepResult.error = `expected statusCode ${exp.statusCode}, got ${res.statusCode}`;
      } else if (exp.bodyContains && !res.body.includes(exp.bodyContains)) {
        stepResult.error = `body does not contain ${JSON.stringify(exp.bodyContains)}`;
      } else if (exp.jsonPath) {
        for (const j of exp.jsonPath) {
          const got = readPath(parsed, j.path);
          if (!deepEqual(got, j.value)) {
            stepResult.error = `jsonPath ${j.path}: expected ${JSON.stringify(j.value)}, got ${JSON.stringify(got)}`;
            break;
          }
        }
      }
      stepResult.passed = stepResult.error === null;
      if (exp.saveAs && stepResult.passed) {
        ctx[exp.saveAs] = parsed;
      }
    } catch (err) {
      stepResult.error = err instanceof Error ? err.message : String(err);
    }
    results.push(stepResult);
    if (!stepResult.passed) break;
  }
  return results;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k, i) =>
        k === kb[i] &&
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

export async function runPipeline(spec: BenchSpec, opts: PipelineCliOpts): Promise<BenchResult> {
  const runId = crypto.randomUUID().slice(0, 8);
  const startedAtIso = new Date().toISOString();
  const startMs = Date.now();
  const workDir = path.join(BENCH_ROOT, ".runs", `${spec.id}-pipeline-${runId}`);
  const dataDir = path.join(os.tmpdir(), `vk-bench-data-${runId}`);
  const shimDir = path.join(os.tmpdir(), `vk-bench-shim-${runId}`);

  const result = makeEmptyResult(spec, runId, startedAtIso, workDir);

  let app: any = null;
  let appAddress = "";
  let dbModule: any = null;
  let originalPath: string | undefined;
  try {
    fs.mkdirSync(path.dirname(workDir), { recursive: true });
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
    copyDirSync(path.join(FIXTURES_DIR, spec.id), workDir, (rel) => rel === "bench.json");
    await gitInit(workDir);

    if (opts.mockClaude && spec.mockFix) {
      fs.writeFileSync(path.join(workDir, ".bench-mockfix.json"), JSON.stringify(spec.mockFix));
    }
    if (opts.mockClaude && spec.mockChain && spec.mockChain.length > 0) {
      fs.writeFileSync(path.join(workDir, ".bench-mockchain.json"), JSON.stringify(spec.mockChain));
    }
    if (opts.mockClaude && spec.mockHangMs && spec.mockHangMs > 0) {
      fs.writeFileSync(path.join(workDir, ".bench-hangms"), String(spec.mockHangMs));
    }

    const port = await findFreePort();

    const fakeClaudeScript = path.join(HARNESS_DIR, "fake-claude.ts");
    const injectClaudeNotFound = spec.injection?.claudeNotFound === true;
    // Phase I: propagate fixture-level injection to fake-claude via env.
    // spawnProcess in server/src/lib/runtime.ts whitelists env to
    // PATH/HOME/USERPROFILE/SYSTEMROOT, so VK_INJECT_* must ride through the
    // bash shim itself rather than process.env.
    const injectionEnv = buildInjectionEnv(spec.injection);
    if (!injectClaudeNotFound) {
      setupShim(shimDir, fakeClaudeScript, `http://127.0.0.1:${port}`, injectionEnv);
    }

    process.env.VK_DATA_DIR = dataDir;
    process.env.PORT = String(port);
    process.env.VK_BENCH_API_URL = `http://127.0.0.1:${port}`;
    process.env.VK_HEADLESS_CLAUDE_TIMEOUT_MS = String(spec.timeoutMs);
    for (const [k, v] of Object.entries(injectionEnv)) process.env[k] = v;
    if (opts.mockClaude) {
      originalPath = process.env.PATH;
      // Even when claudeNotFound is set we still drop the shim dir from PATH —
      // we want spawnProcess to fail with ENOENT, not find a system claude.
      if (injectClaudeNotFound) {
        process.env.PATH = process.env.PATH ?? "";
      } else {
        process.env.PATH = `${shimDir}:${process.env.PATH ?? ""}`;
      }
    }

    const appModule = await import("../../server/src/app");
    dbModule = await import("../../server/src/db");
    const headlessModule = await import("../../server/src/services/headlessClaude");
    app = await appModule.buildApp();
    // Phase I MCP-500 injection: install BEFORE listen so the route hook is in place.
    if (
      spec.injection?.mcp500Rate !== undefined &&
      spec.injection.mcp500Rate !== null &&
      spec.injection.mcp500Rate > 0
    ) {
      const rate = Math.min(1, Math.max(0, spec.injection.mcp500Rate));
      app.addHook("onRequest", async (req: any, reply: any) => {
        if (typeof req.url === "string" && req.url.startsWith("/mcp") && Math.random() < rate) {
          result.injection.mcp500Count = (result.injection.mcp500Count ?? 0) + 1;
          return reply.code(500).send({ error: "injected MCP 500" });
        }
      });
    }
    appAddress = await app.listen({ port, host: "127.0.0.1" });
    result.concurrency.checked = true;
    result.concurrency.statsBefore = headlessModule.getHeadlessClaudeStats();
    result.injection.requested = !!spec.injection;
    result.injection.modes = listInjectionModes(spec.injection);

    const projectRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: `bench-${spec.id}`, path: workDir },
    });
    if (projectRes.statusCode !== 200)
      throw new Error(`POST /api/projects failed: ${projectRes.statusCode} ${projectRes.body}`);
    const project = JSON.parse(projectRes.body);

    await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}`,
      payload: { autoSpawnEnabled: true },
    });

    const pipelineMode = spec.pipelineMode ?? "codebase";

    // server-integration mode short-circuits the AI/task path entirely:
    // it just runs an HTTP script against the booted app. No AI is invoked,
    // no task is created, no diff/test scoring at the end. Coverage of real
    // route handlers is the point.
    if (pipelineMode === "server-integration") {
      const steps = spec.httpScript ?? [];
      const stepResults = await runHttpScript(app, steps, { projectId: project.id });
      result.serverIntegration.ran = true;
      result.serverIntegration.steps = stepResults.map((s) => ({
        name: s.name,
        method: s.method,
        url: s.url,
        statusCode: s.statusCode,
        passed: s.passed,
        error: s.error,
      }));
      result.serverIntegration.allPassed = steps.length > 0 && stepResults.every((s) => s.passed);
      result.tests.targetPassed = result.serverIntegration.allPassed;
      result.tests.regressionsHeld = true;
      result.diff.expectedFilesOnly = true;
      result.diff.withinBudget = true;
      result.chain.depth = 1;
      result.status = result.serverIntegration.allPassed ? "SOLVED" : "TARGET-FAIL";
      result.solved = result.serverIntegration.allPassed;
      return result;
    }

    const taskMetaType =
      pipelineMode === "qa-test"
        ? "qa-test"
        : pipelineMode === "dev-fix"
          ? "dev-fix"
          : "bench-codebase";

    const taskRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/tasks`,
      payload: {
        title: spec.title,
        description: spec.prompt,
        prompt: spec.prompt,
        status: "todo",
        priority: "medium",
        metadata: { type: taskMetaType },
      },
    });
    if (taskRes.statusCode !== 200)
      throw new Error(`POST tasks failed: ${taskRes.statusCode} ${taskRes.body}`);
    const task = JSON.parse(taskRes.body);

    const testsDir = path.join(workDir, "tests");
    const preHash = hashDir(testsDir);

    result.ai.invoked = true;
    const aiStart = Date.now();
    const taskAiRun = await pollForTaskAiRun(dbModule.getDb, task.id, spec.timeoutMs + 5000);
    result.ai.durationMs = Date.now() - aiStart;
    if (!taskAiRun) {
      result.error = `no task_ai_runs row for taskId=${task.id} after ${spec.timeoutMs}ms`;
    } else {
      result.ai.exitCode = taskAiRun.exitCode;
      result.ai.summary = taskAiRun.summary ?? null;
      result.ai.sessionId = taskAiRun.sessionId ?? null;
      if (taskAiRun.summary) {
        const enriched = parseClaudeJson(taskAiRun.summary);
        if (enriched.numTurns !== null) result.ai.numTurns = enriched.numTurns;
        if (enriched.totalCostUsd !== null) result.ai.totalCostUsd = enriched.totalCostUsd;
        if (enriched.models.length) result.ai.models = enriched.models;
      }
    }

    if (spec.mockChain && spec.mockChain.length > 0) {
      const trace = await traceChain(dbModule.getDb, task.id, project.id, spec.timeoutMs);
      result.chain.depth = trace.depth;
      result.chain.parentLinksValid = trace.parentLinksValid;
      result.chain.leafTaskId = trace.leafTaskId;
      result.chain.leafStatus = trace.leafStatus;
      result.chain.totalAiRuns = trace.totalAiRuns;
      result.chain.totalDurationMs = trace.totalDurationMs;
      result.chain.totalCostUsd = trace.totalCostUsd;
    } else {
      result.chain.depth = 1;
      result.chain.leafTaskId = task.id;
      result.chain.leafStatus = taskAiRun ? "done" : null;
      result.chain.totalAiRuns = taskAiRun ? 1 : 0;
      result.chain.totalDurationMs = result.ai.durationMs;
      result.chain.totalCostUsd = result.ai.totalCostUsd ?? 0;
    }
    if (result.chain.expectedDepth !== null) {
      result.chain.expectedDepthMet = result.chain.depth === result.chain.expectedDepth;
    }

    result.concurrency.statsAfter = headlessModule.getHeadlessClaudeStats();
    result.concurrency.slotLeak = result.concurrency.statsAfter.inFlight !== 0;
    if (
      taskAiRun &&
      (taskAiRun.exitCode === null || taskAiRun.exitCode !== 0) &&
      result.ai.durationMs >= spec.timeoutMs * 0.8
    ) {
      result.concurrency.timedOut = true;
    }

    const leafForChecks = result.chain.leafTaskId ?? task.id;
    const seTaskAiRun = verifyTaskAiRun(dbModule.getDb, leafForChecks);
    const seTimestamps = verifyTimestampCascade(dbModule.getDb, leafForChecks);
    const seSnapshot = verifySnapshot(dataDir, project.id, leafForChecks);
    const seEmbeddings = await verifyEmbeddings(dbModule.getDb, leafForChecks, 5000);
    const seSummary = summarize({
      taskAiRun: seTaskAiRun,
      timestamps: seTimestamps,
      snapshot: seSnapshot,
      embeddings: seEmbeddings,
    });
    result.sideEffects.checked = true;
    result.sideEffects.taskAiRun = seSummary.taskAiRun;
    result.sideEffects.timestamps = seSummary.timestamps;
    result.sideEffects.snapshot = seSummary.snapshot;
    result.sideEffects.embeddings = seSummary.embeddings;
    result.sideEffects.allGreen = seSummary.allGreen;

    if (spec.injection) {
      result.injection.rowRecorded = result.sideEffects.taskAiRun.found;
      result.injection.slotLeaked = result.concurrency.slotLeak;
      const cls = classifyFromResult(spec.injection, result);
      result.injection.surfaced = cls.surfaced;
      result.injection.recovered = cls.recovered;
      result.injection.notes = cls.notes;
    }

    runAdversarialChecks(spec, result);

    result.tampering.checked = true;
    const postHash = hashDir(testsDir);
    const changed = compareDirHashes(preHash, postHash);
    if (changed.length > 0) {
      result.tampering.detected = true;
      result.tampering.changedFiles = changed;
    }

    if (fs.existsSync(path.join(workDir, ".bench-mockfix.json"))) {
      fs.rmSync(path.join(workDir, ".bench-mockfix.json"));
    }
    if (fs.existsSync(path.join(workDir, ".bench-mockchain.json"))) {
      fs.rmSync(path.join(workDir, ".bench-mockchain.json"));
    }
    if (fs.existsSync(path.join(workDir, ".bench-hangms"))) {
      fs.rmSync(path.join(workDir, ".bench-hangms"));
    }

    const targetRes = await runCmd(["bun", "test", spec.targetTestPath], workDir, 60_000);
    result.tests.targetExitCode = targetRes.exitCode;
    result.tests.targetPassed = targetRes.exitCode === 0;
    result.tests.targetOutput = targetRes.stdout + "\n" + targetRes.stderr;

    const regRes = await runCmd(["bun", "test", spec.regressionTestPath], workDir, 60_000);
    result.tests.regressionExitCode = regRes.exitCode;
    result.tests.regressionsHeld = regRes.exitCode === 0;
    result.tests.regressionOutput = regRes.stdout + "\n" + regRes.stderr;

    const diffRes = await runCmd(["git", "diff", "--numstat", "HEAD"], workDir);
    const parsedDiff = parseNumstat(diffRes.stdout);
    result.diff.filesChanged = parsedDiff.filesChanged;
    result.diff.linesAdded = parsedDiff.linesAdded;
    result.diff.linesRemoved = parsedDiff.linesRemoved;
    result.diff.withinBudget = parsedDiff.linesAdded + parsedDiff.linesRemoved <= spec.maxDiffLines;
    if (spec.expectedFilesChanged && spec.expectedFilesChanged.length > 0) {
      const expected = new Set(spec.expectedFilesChanged);
      result.diff.expectedFilesOnly =
        parsedDiff.filesChanged.length > 0 && parsedDiff.filesChanged.every((f) => expected.has(f));
    } else {
      result.diff.expectedFilesOnly = true;
    }

    result.status = evaluateStatus(result, opts.lenient);
    result.solved = result.status === "SOLVED";
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.status = "ERROR";
    result.solved = false;
  } finally {
    result.durationMs = Date.now() - startMs;
    if (app) {
      try {
        await app.close();
      } catch {
        // best-effort
      }
    }
    if (dbModule?.closeDb) {
      try {
        dbModule.closeDb();
      } catch {
        // best-effort
      }
    }
    if (originalPath !== undefined) process.env.PATH = originalPath;
    delete process.env.VK_DATA_DIR;
    delete process.env.VK_BENCH_API_URL;
    delete process.env.VK_HEADLESS_CLAUDE_TIMEOUT_MS;
    delete process.env.VK_INJECT_OUTPUT_FORMAT_BROKEN;
    delete process.env.VK_INJECT_KILL_AFTER_MS;
    delete process.env.VK_INJECT_MCP_500_RATE;
    delete process.env.VK_INJECT_CLAUDE_NOT_FOUND;
    if (!opts.keepWorkdir) {
      for (const dir of [workDir, dataDir, shimDir]) {
        if (fs.existsSync(dir)) {
          try {
            fs.rmSync(dir, { recursive: true, force: true });
          } catch {
            // best-effort
          }
        }
      }
    }
    void appAddress;
  }

  return result;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.fixtureId) {
    console.error(
      "usage: pipeline.ts --fixture=<id> [--mock-claude|--real-claude] [--lenient] [--keep] [--result-file=<path>]",
    );
    process.exit(2);
  }
  const spec = loadSpec(opts.fixtureId);
  const result = await runPipeline(spec, opts);
  const json = JSON.stringify(result);
  if (opts.resultFile) {
    fs.writeFileSync(opts.resultFile, json);
  } else {
    process.stdout.write(json);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
