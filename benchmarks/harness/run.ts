#!/usr/bin/env bun
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";
import { buildReport, writeReports, parseNumstat } from "./score";
import { verifyMultiFile } from "./multiFile";
import {
  aggregate,
  compareAgainstBaseline,
  compareReports,
  formatAggregateMd,
  formatBaselineMd,
  formatCompareMd,
  loadAllReports,
  loadFixtureSpecs,
  loadReport,
  writeAggregate,
  writeCompare,
} from "./aggregate";
import { calibrate, formatCalibrationMd, formatCalibrationText } from "./calibrate";
import type { BenchAggregateReport, BenchSpec, BenchResult, BenchStatus } from "./types";

const HARNESS_DIR = path.resolve(import.meta.dir);
const BENCH_ROOT = path.resolve(HARNESS_DIR, "..");
export const FIXTURES_DIR = path.join(BENCH_ROOT, "fixtures");
const RESULTS_DIR = path.join(BENCH_ROOT, "results");
const RUNS_DIR = path.join(BENCH_ROOT, ".runs");

type Mode = "harness" | "pipeline";

interface CliOpts {
  fixtures: string[];
  dryRun: boolean;
  mock: boolean;
  lenient: boolean;
  keepWorkdir: boolean;
  outDir: string;
  mode: Mode;
  mockClaude: boolean;
  parallel: number;
  ci: boolean;
  baseline: string | null;
  commentOut: string | null;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    fixtures: [],
    dryRun: false,
    mock: false,
    lenient: false,
    keepWorkdir: false,
    outDir: RESULTS_DIR,
    mode: "harness",
    mockClaude: false,
    parallel: 1,
    ci: false,
    baseline: null,
    commentOut: null,
  };
  for (const a of argv) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--mock") opts.mock = true;
    else if (a === "--lenient") opts.lenient = true;
    else if (a === "--keep") opts.keepWorkdir = true;
    else if (a === "--mock-claude") opts.mockClaude = true;
    else if (a === "--ci") opts.ci = true;
    else if (a.startsWith("--baseline=")) opts.baseline = path.resolve(a.slice("--baseline=".length));
    else if (a.startsWith("--comment-out=")) opts.commentOut = path.resolve(a.slice("--comment-out=".length));
    else if (a.startsWith("--parallel=")) {
      const n = Number(a.slice("--parallel=".length));
      if (!Number.isFinite(n) || n < 1) {
        console.error(`--parallel must be a positive integer, got: ${a}`);
        process.exit(2);
      }
      opts.parallel = Math.floor(n);
    } else if (a.startsWith("--mode=")) {
      const v = a.slice("--mode=".length);
      if (v !== "harness" && v !== "pipeline") {
        console.error(`unknown --mode value: ${v} (valid: harness | pipeline)`);
        process.exit(2);
      }
      opts.mode = v;
    } else if (a.startsWith("--fixture=")) opts.fixtures.push(a.slice("--fixture=".length));
    else if (a.startsWith("--out=")) opts.outDir = path.resolve(a.slice("--out=".length));
    else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (a.startsWith("--")) {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

const USAGE = `usage: bun run benchmarks/harness/run.ts [subcommand] [flags]

subcommands:
  (default)              run benchmark(s)
  aggregate              roll-up all results/*.json (solve-rate by fixture/model/week + cost)
  compare <a> <b>        diff two report .json files; highlights regressions + improvements
  calibrate              flag fixtures whose rolling solve-rate drifts past trivial/harder thresholds

flags (default subcommand):
  --mode=<m>       harness (default) — direct claude CLI on a copy
                   pipeline           — boot buildApp() + create task + watch task_ai_runs
  --fixture=<id>   run only this fixture (repeatable). default: all
  --dry-run        skip AI invocation; verify wiring only (harness mode)
  --mock           apply a known-good fix from bench.json (harness mode)
  --mock-claude    pipeline mode: PATH-shim a fake claude that applies bench.json mockFix
  --lenient        score with v1 rules (target+regressions only); strict mode also gates on diff budget + expected files
  --keep           keep the work dir after the run (default: delete)
  --parallel=<n>   run up to N fixtures concurrently (default: 1)
  --out=<dir>      write results here (default: benchmarks/results)
  --ci             single-line summary; exit 1 if any fixture regressed vs --baseline
  --baseline=<p>   baseline aggregate-*.json to compare against (used with --ci)
  --comment-out=<p>  write PR-comment markdown delta table to <p> (used with --baseline)
  -h, --help       this message

each fixture is benchmarks/fixtures/<id>/ with:
  bench.json    spec (prompt, target test, regression test, budgets)
  src/          codebase the AI works in
  tests/        target.test.ts + regression.test.ts (bun test)
`;

function listFixtures(): string[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => fs.existsSync(path.join(FIXTURES_DIR, id, "bench.json")))
    .sort();
}

function loadSpec(fixtureId: string): BenchSpec {
  const specPath = path.join(FIXTURES_DIR, fixtureId, "bench.json");
  const raw = fs.readFileSync(specPath, "utf-8");
  return JSON.parse(raw) as BenchSpec;
}

export function copyDirSync(src: string, dst: string, ignore?: (relPath: string) => boolean): void {
  function walk(srcDir: string, dstDir: string, relDir: string): void {
    fs.mkdirSync(dstDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const childRel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (ignore && ignore(childRel)) continue;
      const s = path.join(srcDir, entry.name);
      const d = path.join(dstDir, entry.name);
      if (entry.isDirectory()) walk(s, d, childRel);
      else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
      else fs.copyFileSync(s, d);
    }
  }
  walk(src, dst, "");
}

export function hashDir(dir: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!fs.existsSync(dir)) return result;
  function walk(rel: string): void {
    const abs = rel === "" ? dir : path.join(dir, rel);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(abs)) {
        const childRel = rel === "" ? entry : `${rel}/${entry}`;
        walk(childRel);
      }
    } else if (stat.isFile()) {
      const h = createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
      result.set(rel, h);
    }
  }
  walk("");
  return result;
}

export function compareDirHashes(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed: string[] = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const k of keys) {
    if (before.get(k) !== after.get(k)) changed.push(k);
  }
  return changed.sort();
}

export interface ParsedClaudeAi {
  summary: string | null;
  sessionId: string | null;
  models: string[];
  numTurns: number | null;
  totalCostUsd: number | null;
  durationApiMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
  terminalReason: string | null;
  permissionDenials: number | null;
}

export function parseClaudeJson(stdout: string): ParsedClaudeAi {
  const empty: ParsedClaudeAi = {
    summary: null,
    sessionId: null,
    models: [],
    numTurns: null,
    totalCostUsd: null,
    durationApiMs: null,
    inputTokens: null,
    outputTokens: null,
    stopReason: null,
    terminalReason: null,
    permissionDenials: null,
  };
  const trimmed = stdout.trim();
  if (!trimmed) return empty;
  let parsed: any = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj && (obj.session_id || obj.result)) {
          parsed = obj;
          break;
        }
      } catch {
        // keep scanning
      }
    }
    if (!parsed) return { ...empty, summary: trimmed.slice(-1500) };
  }
  return {
    summary: parsed.result ?? parsed.summary ?? null,
    sessionId: parsed.session_id ?? parsed.sessionId ?? null,
    models: parsed.modelUsage && typeof parsed.modelUsage === "object" ? Object.keys(parsed.modelUsage) : [],
    numTurns: typeof parsed.num_turns === "number" ? parsed.num_turns : null,
    totalCostUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null,
    durationApiMs: typeof parsed.duration_api_ms === "number" ? parsed.duration_api_ms : null,
    inputTokens: typeof parsed.usage?.input_tokens === "number" ? parsed.usage.input_tokens : null,
    outputTokens: typeof parsed.usage?.output_tokens === "number" ? parsed.usage.output_tokens : null,
    stopReason: parsed.stop_reason ?? null,
    terminalReason: parsed.terminal_reason ?? null,
    permissionDenials: Array.isArray(parsed.permission_denials) ? parsed.permission_denials.length : null,
  };
}

export function detectMisFixture(targetExitCode: number, regressionExitCode: number): { misFixture: boolean; reason: string | null } {
  if (targetExitCode === 0) {
    return { misFixture: true, reason: "baseline target test already passes — fixture has nothing to solve" };
  }
  if (regressionExitCode !== 0) {
    return { misFixture: true, reason: "baseline regression test fails — fixture has a broken baseline" };
  }
  return { misFixture: false, reason: null };
}

export function evaluateStatus(r: BenchResult, lenient: boolean): BenchStatus {
  if (r.error) return "ERROR";
  if (r.preflight.misFixture) return "MIS-FIXTURE";
  if (r.tampering.detected) return "TAMPERED";
  const t = r.tests;
  if (t.targetPassed && t.regressionsHeld) {
    if (!lenient && (!r.diff.withinBudget || !r.diff.expectedFilesOnly)) return "SPRAWL";
    if (!lenient && r.multiFile.checked && !r.multiFile.allTouched) return "INSUFFICIENT-FILES";
    return "SOLVED";
  }
  if (r.concurrency.timedOut && !t.targetPassed) return "TIMEOUT";
  if (t.targetPassed && !t.regressionsHeld) return "TARGET-ONLY";
  if (!t.targetPassed && t.regressionsHeld) return "TARGET-FAIL";
  return "REGRESSED";
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCmd(cmd: string[], cwd: string, timeoutMs?: number, env?: Record<string, string>): Promise<SpawnResult> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...(env || {}) },
  });
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

function makeEmptyResult(spec: BenchSpec, runId: string, startedAtIso: string, workDir: string): BenchResult {
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
    diff: { filesChanged: [], linesAdded: 0, linesRemoved: 0, withinBudget: false, expectedFilesOnly: false },
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
      taskAiRun: { found: false, exitCode: null, success: null, durationMs: null, sessionIdSet: false, summarySet: false },
      timestamps: { inboxAtSet: false, inProgressAtSet: false, doneAtSet: false, cascadeOrdered: false },
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
    status: "ERROR",
    solved: false,
    error: null,
  };
}

async function runOne(spec: BenchSpec, opts: CliOpts): Promise<BenchResult> {
  const runId = crypto.randomUUID().slice(0, 8);
  const startedAtIso = new Date().toISOString();
  const startMs = Date.now();
  const workDir = path.join(RUNS_DIR, `${spec.id}-${runId}`);

  const result = makeEmptyResult(spec, runId, startedAtIso, workDir);

  try {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
    copyDirSync(path.join(FIXTURES_DIR, spec.id), workDir, (rel) => rel === "bench.json");
    await gitInit(workDir);

    if (!opts.mock && !opts.dryRun) {
      result.preflight.ran = true;
      const ptarget = await runCmd(["bun", "test", spec.targetTestPath], workDir, 60_000);
      const preg = await runCmd(["bun", "test", spec.regressionTestPath], workDir, 60_000);
      const m = detectMisFixture(ptarget.exitCode, preg.exitCode);
      result.preflight.misFixture = m.misFixture;
      result.preflight.reason = m.reason;
    }

    if (!result.preflight.misFixture) {
      const testsDir = path.join(workDir, "tests");
      const preHash = hashDir(testsDir);

      if (opts.dryRun) {
        result.ai.invoked = false;
      } else if (opts.mock) {
        if (!spec.mockFix || Object.keys(spec.mockFix).length === 0) {
          result.error = `--mock: fixture ${spec.id} has no mockFix in bench.json`;
        } else {
          for (const [relPath, content] of Object.entries(spec.mockFix)) {
            const target = path.join(workDir, relPath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content);
          }
          result.ai.invoked = false;
        }
      } else {
        const aiStart = Date.now();
        result.ai.invoked = true;
        const claudeRes = await runCmd(
          [
            "claude",
            "-p",
            "--output-format",
            "json",
            "--dangerously-skip-permissions",
            spec.prompt,
          ],
          workDir,
          spec.timeoutMs,
        );
        result.ai.durationMs = Date.now() - aiStart;
        result.ai.exitCode = claudeRes.exitCode;
        Object.assign(result.ai, parseClaudeJson(claudeRes.stdout));

        result.tampering.checked = true;
        const postHash = hashDir(testsDir);
        const changed = compareDirHashes(preHash, postHash);
        if (changed.length > 0) {
          result.tampering.detected = true;
          result.tampering.changedFiles = changed;
        }
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
        result.diff.expectedFilesOnly = parsedDiff.filesChanged.length > 0 && parsedDiff.filesChanged.every((f) => expected.has(f));
      } else {
        result.diff.expectedFilesOnly = true;
      }

      if (spec.requireFiles && spec.requireFiles.length > 0) {
        const mf = await verifyMultiFile(workDir, spec.requireFiles);
        result.multiFile.checked = true;
        result.multiFile.missing = mf.missing;
        result.multiFile.trivial = mf.trivial;
        result.multiFile.allTouched = mf.allTouched;
        if (!mf.allTouched && opts.lenient) {
          console.warn(`[lenient] ${spec.id}: requireFiles not fully satisfied (missing=[${mf.missing.join(",")}] trivial=[${mf.trivial.join(",")}])`);
        }
      }
    }

    result.status = evaluateStatus(result, opts.lenient);
    result.solved = result.status === "SOLVED";
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.status = "ERROR";
    result.solved = false;
  } finally {
    result.durationMs = Date.now() - startMs;
    if (!opts.keepWorkdir && fs.existsSync(workDir)) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }

  return result;
}

function printOneLine(r: BenchResult): void {
  const aiBit = r.ai.invoked ? `ai=${r.ai.exitCode} ${(r.ai.durationMs / 1000).toFixed(1)}s` : "ai=skipped";
  const detail = r.preflight.misFixture
    ? ` reason="${r.preflight.reason}"`
    : r.tampering.detected
      ? ` tampered=[${r.tampering.changedFiles.join(", ")}]`
      : ` target=${r.tests.targetPassed ? "pass" : "fail"} reg=${r.tests.regressionsHeld ? "held" : "broke"} diff=+${r.diff.linesAdded}/-${r.diff.linesRemoved}`;
  console.log(
    `[${r.status}] ${r.fixtureId.padEnd(30)}${detail} ${aiBit} total=${(r.durationMs / 1000).toFixed(1)}s${r.error ? ` ERR:${r.error}` : ""}`,
  );
}

async function runOnePipeline(fixtureId: string, opts: CliOpts): Promise<BenchResult> {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const resultFile = path.join(RUNS_DIR, `${fixtureId}-pipeline-${crypto.randomUUID().slice(0, 8)}-result.json`);
  const pipelineScript = path.join(HARNESS_DIR, "pipeline.ts");
  const cmd = [
    process.execPath,
    pipelineScript,
    `--fixture=${fixtureId}`,
    `--result-file=${resultFile}`,
    opts.mockClaude ? "--mock-claude" : "--real-claude",
  ];
  if (opts.lenient) cmd.push("--lenient");
  if (opts.keepWorkdir) cmd.push("--keep");
  const env = { ...process.env };
  if (opts.parallel > 1) env.VK_DISABLE_EMBEDDINGS = "1";
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0 || !fs.existsSync(resultFile)) {
    throw new Error(`pipeline subprocess failed (exit=${exitCode})\nstdout tail: ${stdout.slice(-500)}\nstderr tail: ${stderr.slice(-500)}`);
  }
  const raw = fs.readFileSync(resultFile, "utf-8");
  fs.rmSync(resultFile);
  return JSON.parse(raw) as BenchResult;
}

async function runAggregateSubcommand(args: string[]): Promise<void> {
  let outDir = RESULTS_DIR;
  let resultsDir = RESULTS_DIR;
  for (const a of args) {
    if (a.startsWith("--out=")) outDir = path.resolve(a.slice("--out=".length));
    else if (a.startsWith("--results=")) resultsDir = path.resolve(a.slice("--results=".length));
    else if (a.startsWith("--")) {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  const reports = loadAllReports(resultsDir).filter((rep) => Array.isArray(rep.results));
  if (reports.length === 0) {
    console.error(`no reports found under ${resultsDir}`);
    process.exit(1);
  }
  const specs = loadFixtureSpecs(FIXTURES_DIR);
  const agg = aggregate(reports, specs);
  const { jsonPath, mdPath } = writeAggregate(agg, outDir);
  console.log(formatAggregateMd(agg));
  console.log(`json: ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`md:   ${path.relative(process.cwd(), mdPath)}`);
}

async function runCompareSubcommand(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length < 2) {
    console.error("usage: bun run bench compare <before.json> <after.json>");
    process.exit(2);
  }
  let outDir = RESULTS_DIR;
  for (const a of args) {
    if (a.startsWith("--out=")) outDir = path.resolve(a.slice("--out=".length));
  }
  const beforePath = path.resolve(positional[0]);
  const afterPath = path.resolve(positional[1]);
  if (!fs.existsSync(beforePath)) {
    console.error(`not found: ${beforePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(afterPath)) {
    console.error(`not found: ${afterPath}`);
    process.exit(1);
  }
  const before = loadReport(beforePath);
  const after = loadReport(afterPath);
  const cmp = compareReports(before, after, beforePath, afterPath);
  const { jsonPath, mdPath } = writeCompare(cmp, outDir);
  console.log(formatCompareMd(cmp));
  console.log(`json: ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`md:   ${path.relative(process.cwd(), mdPath)}`);
}

async function runCalibrateSubcommand(args: string[]): Promise<void> {
  let outDir = RESULTS_DIR;
  let resultsDir = RESULTS_DIR;
  let windowDays = 30;
  let trivialThreshold = 0.95;
  let harderThreshold = 0.20;
  let minSamples = 3;
  let writeFiles = false;
  for (const a of args) {
    if (a.startsWith("--out=")) outDir = path.resolve(a.slice("--out=".length));
    else if (a.startsWith("--results=")) resultsDir = path.resolve(a.slice("--results=".length));
    else if (a.startsWith("--window=")) {
      const n = Number(a.slice("--window=".length));
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`--window must be a positive number of days, got: ${a}`);
        process.exit(2);
      }
      windowDays = n;
    } else if (a.startsWith("--trivial=")) {
      const n = Number(a.slice("--trivial=".length));
      if (!Number.isFinite(n) || n <= 0 || n > 1) {
        console.error(`--trivial must be in (0,1], got: ${a}`);
        process.exit(2);
      }
      trivialThreshold = n;
    } else if (a.startsWith("--harder=")) {
      const n = Number(a.slice("--harder=".length));
      if (!Number.isFinite(n) || n < 0 || n >= 1) {
        console.error(`--harder must be in [0,1), got: ${a}`);
        process.exit(2);
      }
      harderThreshold = n;
    } else if (a.startsWith("--min-samples=")) {
      const n = Number(a.slice("--min-samples=".length));
      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
        console.error(`--min-samples must be a positive integer, got: ${a}`);
        process.exit(2);
      }
      minSamples = n;
    } else if (a === "--write") {
      writeFiles = true;
    } else if (a.startsWith("--")) {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  if (harderThreshold >= trivialThreshold) {
    console.error(`--harder (${harderThreshold}) must be < --trivial (${trivialThreshold})`);
    process.exit(2);
  }
  const reports = loadAllReports(resultsDir);
  if (reports.length === 0) {
    console.error(`no reports found under ${resultsDir}`);
    process.exit(1);
  }
  const specs = loadFixtureSpecs(FIXTURES_DIR);
  const cal = calibrate(reports, specs, { windowDays, trivialThreshold, harderThreshold, minSamples });
  console.log(formatCalibrationText(cal));
  if (writeFiles) {
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = cal.generatedAt.replace(/[:.]/g, "-");
    const jsonPath = path.join(outDir, `calibrate-${stamp}.json`);
    const mdPath = path.join(outDir, `calibrate-${stamp}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(cal, null, 2));
    fs.writeFileSync(mdPath, formatCalibrationMd(cal));
    console.log("");
    console.log(`json: ${path.relative(process.cwd(), jsonPath)}`);
    console.log(`md:   ${path.relative(process.cwd(), mdPath)}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  if (sub === "aggregate") return runAggregateSubcommand(argv.slice(1));
  if (sub === "compare") return runCompareSubcommand(argv.slice(1));
  if (sub === "calibrate") return runCalibrateSubcommand(argv.slice(1));

  const opts = parseArgs(argv);
  const all = listFixtures();
  if (all.length === 0) {
    console.error(`no fixtures found under ${FIXTURES_DIR}`);
    process.exit(1);
  }

  const selected = opts.fixtures.length > 0 ? opts.fixtures.filter((id) => all.includes(id)) : all;
  if (selected.length === 0) {
    console.error(`no matching fixtures (available: ${all.join(", ")})`);
    process.exit(1);
  }

  console.log(
    `benchmark run · mode=${opts.mode} · fixtures: ${selected.join(", ")} · dryRun=${opts.dryRun} mock=${opts.mock} mockClaude=${opts.mockClaude} lenient=${opts.lenient}`,
  );

  if (opts.mode === "harness" && !opts.dryRun && !opts.mock) {
    if (!await isClaudeAvailable()) {
      console.error("`claude` binary not found in PATH — install Claude CLI or use --dry-run");
      process.exit(1);
    }
  }
  if (opts.mode === "pipeline" && !opts.mockClaude) {
    if (!await isClaudeAvailable()) {
      console.error("pipeline mode without --mock-claude requires `claude` in PATH");
      process.exit(1);
    }
  }

  const startedAt = new Date().toISOString();
  const fixturesToRun: { id: string; spec: BenchSpec }[] = [];
  for (const fixtureId of selected) {
    let spec: BenchSpec;
    try {
      spec = loadSpec(fixtureId);
    } catch (err) {
      console.error(`failed to load ${fixtureId}: ${err}`);
      continue;
    }
    if (opts.mode === "harness" && spec.mockChain && spec.mockChain.length > 0) {
      console.log(`[skipped] ${fixtureId.padEnd(30)} pipeline-only fixture (mockChain set); use --mode=pipeline`);
      continue;
    }
    fixturesToRun.push({ id: fixtureId, spec });
  }

  const runOneFixture = async ({ id, spec }: { id: string; spec: BenchSpec }): Promise<BenchResult> => {
    if (opts.mode === "pipeline") {
      try {
        return await runOnePipeline(id, opts);
      } catch (err) {
        const r = makeEmptyResult(spec, "0".repeat(8), new Date().toISOString(), "");
        r.error = err instanceof Error ? err.message : String(err);
        r.status = "ERROR";
        r.solved = false;
        return r;
      }
    }
    return runOne(spec, opts);
  };

  const results: BenchResult[] = [];
  if (opts.parallel <= 1) {
    for (const f of fixturesToRun) {
      const r = await runOneFixture(f);
      printOneLine(r);
      results.push(r);
    }
  } else {
    for (let i = 0; i < fixturesToRun.length; i += opts.parallel) {
      const chunk = fixturesToRun.slice(i, i + opts.parallel);
      const chunkResults = await Promise.all(chunk.map(runOneFixture));
      for (const r of chunkResults) {
        printOneLine(r);
        results.push(r);
      }
    }
  }
  const finishedAt = new Date().toISOString();

  const report = buildReport(results, startedAt, finishedAt);
  const { jsonPath, mdPath } = writeReports(report, opts.outDir);

  if (opts.baseline) {
    if (!fs.existsSync(opts.baseline)) {
      console.error(`baseline not found: ${opts.baseline}`);
      process.exit(2);
    }
    const baseline = JSON.parse(fs.readFileSync(opts.baseline, "utf-8")) as BenchAggregateReport;
    const cmp = compareAgainstBaseline([report], baseline);
    if (opts.commentOut) {
      fs.mkdirSync(path.dirname(opts.commentOut), { recursive: true });
      fs.writeFileSync(opts.commentOut, formatBaselineMd(cmp));
    }
    if (opts.ci) {
      const summary = `bench-ci · solved ${report.solvedCount}/${report.count} · regressed=${cmp.regressions.length} improved=${cmp.improvements.length} added=${cmp.added.length} removed=${cmp.removed.length} costΔ=$${cmp.costDelta.toFixed(4)}`;
      console.log(summary);
      if (cmp.regressions.length > 0) {
        console.error(`regressed fixtures: ${cmp.regressions.join(", ")}`);
        process.exit(1);
      }
      return;
    }
    console.log("");
    console.log(`solved ${report.solvedCount}/${report.count}`);
    console.log(`vs baseline: regressed=${cmp.regressions.length} improved=${cmp.improvements.length} added=${cmp.added.length} removed=${cmp.removed.length} costΔ=$${cmp.costDelta.toFixed(4)}`);
    console.log(`report: ${path.relative(process.cwd(), mdPath)}`);
    console.log(`json:   ${path.relative(process.cwd(), jsonPath)}`);
    return;
  }

  if (opts.ci) {
    const failed = report.results.filter((r) => !r.solved).map((r) => r.fixtureId);
    console.log(`bench-ci · solved ${report.solvedCount}/${report.count} · failed=${failed.length}${failed.length ? ` [${failed.join(", ")}]` : ""}`);
    if (failed.length > 0) process.exit(1);
    return;
  }

  console.log("");
  console.log(`solved ${report.solvedCount}/${report.count}`);
  console.log(`report: ${path.relative(process.cwd(), mdPath)}`);
  console.log(`json:   ${path.relative(process.cwd(), jsonPath)}`);
}

async function isClaudeAvailable(): Promise<boolean> {
  const res = await runCmd(["which", "claude"], os.homedir());
  return res.exitCode === 0 && res.stdout.trim().length > 0;
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
