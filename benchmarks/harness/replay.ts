/**
 * Phase L2: replay runner for captured `task_ai_runs`.
 *
 * Pairs with `server/src/services/taskAiCapture.ts`. Loads a `<slug>.json`
 * sidecar + adjacent `<slug>.tar.gz`, extracts the workdir into a temp dir,
 * boots a pipeline-bench app, reissues the task, and reports the replayed
 * outcome alongside the captured one.
 *
 * Strict separation: we set VK_BENCH_CAPTURE=0 during replay so a replay
 * cannot self-feed by capturing itself.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";

import type { ReplayPayloadSidecar } from "../../server/src/services/taskAiCapture";

const HARNESS_DIR = path.resolve(import.meta.dir);
const BENCH_ROOT = path.resolve(HARNESS_DIR, "..");
const REPLAYS_DIR = path.join(BENCH_ROOT, "replays");

export interface ReplayOpts {
  mockClaude: boolean;
  timeoutMs: number;
  keepWorkdir: boolean;
}

export interface ReplayOutcome {
  exitCode: number | null;
  summary: string | null;
  sessionId: string | null;
  durationMs: number;
}

export interface ReplayResult {
  sidecarPath: string;
  runId: string;
  taskId: string;
  projectId: string;
  workDir: string;
  /** Project nameHash from the sidecar payload — stable identity for grouping replays of the same anonymized project. */
  projectNameHash: string;
  /** ISO timestamp from the sidecar (when the original run was captured). */
  capturedAt: string;
  /** Anonymized task metadata as captured (or null). Used by the calibrate adapter to infer category. */
  taskMetadata: Record<string, unknown> | null;
  captured: ReplayPayloadSidecar["outcome"];
  replay: ReplayOutcome;
  comparison: {
    exitCodeMatches: boolean;
    bothNonZero: boolean;
    bothZero: boolean;
  };
  error: string | null;
}

export function loadReplaySidecar(sidecarPath: string): ReplayPayloadSidecar {
  const raw = fs.readFileSync(sidecarPath, "utf8");
  const parsed = JSON.parse(raw) as ReplayPayloadSidecar;
  if (typeof parsed.schemaVersion !== "number") {
    throw new Error(`replay sidecar missing schemaVersion: ${sidecarPath}`);
  }
  if (!parsed.runId || !parsed.taskId || !parsed.projectId) {
    throw new Error(`replay sidecar missing identifiers: ${sidecarPath}`);
  }
  if (!parsed.workdirArchive) {
    throw new Error(`replay sidecar missing workdirArchive: ${sidecarPath}`);
  }
  return parsed;
}

export function listReplaySidecars(
  dir: string = REPLAYS_DIR,
  opts: { since?: string | null; runId?: string | null } = {},
): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  return entries
    .filter((f) => {
      if (opts.runId) return f.includes(opts.runId);
      if (opts.since) {
        // file format: 2026-05-09T01-23-45-678Z-<runId>.json
        const stamp = f.split("-").slice(0, 3).join("-"); // crude: YYYY-MM-DD
        return stamp >= opts.since;
      }
      return true;
    })
    .map((f) => path.join(dir, f))
    .sort();
}

async function findFreePort(): Promise<number> {
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

export function expandWorkdirPlaceholders(text: string | null, workDir: string): string | null {
  if (text == null) return text;
  return text.split("<workdir>").join(workDir);
}

async function pollForTaskAiRun(
  getDb: () => any,
  taskId: string,
  timeoutMs: number,
): Promise<{
  exitCode: number | null;
  summary: string | null;
  sessionId: string | null;
  durationMs: number | null;
} | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = getDb()
      .prepare("SELECT * FROM task_ai_runs WHERE taskId = ? ORDER BY createdAt DESC LIMIT 1")
      .get(taskId) as
      | {
          exitCode: number | null;
          summary: string | null;
          sessionId: string | null;
          durationMs: number | null;
        }
      | undefined;
    if (row) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

function setupMockClaudeShim(shimDir: string, apiUrl: string): string {
  fs.mkdirSync(shimDir, { recursive: true });
  const fakeClaudeScript = path.join(HARNESS_DIR, "fake-claude.ts");
  const claudePath = path.join(shimDir, "claude");
  fs.writeFileSync(
    claudePath,
    `#!/usr/bin/env bash\nVK_BENCH_API_URL=${apiUrl} bun ${fakeClaudeScript} "$@"\n`,
    { mode: 0o755 },
  );
  return shimDir;
}

export async function runReplay(sidecarPath: string, opts: ReplayOpts): Promise<ReplayResult> {
  const sidecar = loadReplaySidecar(sidecarPath);
  const dir = path.dirname(sidecarPath);
  const archivePath = path.join(dir, sidecar.workdirArchive);
  if (!fs.existsSync(archivePath)) {
    throw new Error(`workdir archive not found: ${archivePath}`);
  }

  const stamp = Date.now();
  const workDir = path.join(os.tmpdir(), `vk-bench-replay-${stamp}-${sidecar.runId.slice(0, 8)}`);
  const dataDir = path.join(os.tmpdir(), `vk-bench-replay-data-${stamp}`);
  const shimDir = path.join(os.tmpdir(), `vk-bench-replay-shim-${stamp}`);
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const result: ReplayResult = {
    sidecarPath,
    runId: sidecar.runId,
    taskId: sidecar.taskId,
    projectId: sidecar.projectId,
    workDir,
    projectNameHash: sidecar.payload.project.nameHash,
    capturedAt: sidecar.capturedAt,
    taskMetadata: sidecar.payload.task.metadata,
    captured: sidecar.outcome,
    replay: { exitCode: null, summary: null, sessionId: null, durationMs: 0 },
    comparison: { exitCodeMatches: false, bothNonZero: false, bothZero: false },
    error: null,
  };

  let app: any = null;
  const originalPath = process.env.PATH;
  const originalCapture = process.env.VK_BENCH_CAPTURE;
  const originalDataDir = process.env.VK_DATA_DIR;
  const originalApi = process.env.VK_BENCH_API_URL;
  const originalPort = process.env.PORT;
  const originalTimeout = process.env.VK_HEADLESS_CLAUDE_TIMEOUT_MS;

  try {
    const { spawnProcess } = await import("../../server/src/lib/runtime");
    const tarRes = await spawnProcess(["tar", "-xzf", archivePath, "-C", workDir], {
      cwd: workDir,
      timeout: 60_000,
    });
    if (tarRes.exitCode !== 0) {
      result.error = `tar extract failed: ${tarRes.stderr.slice(-300)}`;
      return result;
    }
    // tar -czf bundles the workdir as a single top-level entry; locate it.
    const entries = fs.readdirSync(workDir);
    const innerName = entries.find((e) => fs.statSync(path.join(workDir, e)).isDirectory());
    const innerWorkDir = innerName ? path.join(workDir, innerName) : workDir;

    // Disable capture inside replay so a replay cannot self-feed.
    process.env.VK_BENCH_CAPTURE = "0";
    process.env.VK_DATA_DIR = dataDir;
    process.env.VK_HEADLESS_CLAUDE_TIMEOUT_MS = String(opts.timeoutMs);

    const port = await findFreePort();
    process.env.PORT = String(port);
    process.env.VK_BENCH_API_URL = `http://127.0.0.1:${port}`;

    if (opts.mockClaude) {
      setupMockClaudeShim(shimDir, `http://127.0.0.1:${port}`);
      process.env.PATH = `${shimDir}:${process.env.PATH ?? ""}`;
    }

    const appModule = await import("../../server/src/app");
    const dbModule = await import("../../server/src/db");
    app = await appModule.buildApp();
    await app.listen({ port, host: "127.0.0.1" });

    const projectRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: `replay-${sidecar.runId.slice(0, 8)}`, path: innerWorkDir },
    });
    if (projectRes.statusCode !== 200) {
      result.error = `POST /api/projects failed: ${projectRes.statusCode}`;
      return result;
    }
    const project = JSON.parse(projectRes.body);
    await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}`,
      payload: { autoSpawnEnabled: true },
    });

    const expandedTitle = expandWorkdirPlaceholders(sidecar.payload.task.title, innerWorkDir) ?? "";
    const expandedDescription = expandWorkdirPlaceholders(
      sidecar.payload.task.description,
      innerWorkDir,
    );
    const expandedPrompt = expandWorkdirPlaceholders(sidecar.payload.task.prompt, innerWorkDir);

    const taskRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/tasks`,
      payload: {
        title: expandedTitle || "replay",
        description: expandedDescription,
        prompt: expandedPrompt ?? expandedDescription ?? "",
        status: "todo",
        priority: "medium",
        metadata: sidecar.payload.task.metadata ?? { type: "bench-replay" },
      },
    });
    if (taskRes.statusCode !== 200) {
      result.error = `POST tasks failed: ${taskRes.statusCode}`;
      return result;
    }
    const task = JSON.parse(taskRes.body);

    const aiStart = Date.now();
    const row = await pollForTaskAiRun(dbModule.getDb, task.id, opts.timeoutMs + 5000);
    result.replay.durationMs = Date.now() - aiStart;
    if (!row) {
      result.error = `no task_ai_runs row for taskId=${task.id} within ${opts.timeoutMs}ms`;
    } else {
      result.replay.exitCode = row.exitCode;
      result.replay.summary = row.summary;
      result.replay.sessionId = row.sessionId;
    }
  } catch (e) {
    result.error = `${e instanceof Error ? e.message : String(e)}`;
  } finally {
    if (app) {
      try {
        await app.close();
      } catch {
        // ignore
      }
    }
    process.env.PATH = originalPath ?? "";
    if (originalCapture === undefined) delete process.env.VK_BENCH_CAPTURE;
    else process.env.VK_BENCH_CAPTURE = originalCapture;
    if (originalDataDir === undefined) delete process.env.VK_DATA_DIR;
    else process.env.VK_DATA_DIR = originalDataDir;
    if (originalApi === undefined) delete process.env.VK_BENCH_API_URL;
    else process.env.VK_BENCH_API_URL = originalApi;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalTimeout === undefined) delete process.env.VK_HEADLESS_CLAUDE_TIMEOUT_MS;
    else process.env.VK_HEADLESS_CLAUDE_TIMEOUT_MS = originalTimeout;
    if (!opts.keepWorkdir) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(shimDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  result.comparison = compareOutcomes(sidecar.outcome.exitCode, result.replay.exitCode);
  return result;
}

export function compareOutcomes(
  capturedExit: number,
  replayExit: number | null,
): ReplayResult["comparison"] {
  return {
    exitCodeMatches: capturedExit === replayExit,
    bothNonZero: capturedExit !== 0 && replayExit !== null && replayExit !== 0,
    bothZero: capturedExit === 0 && replayExit === 0,
  };
}

export function summarizeReplays(results: ReplayResult[]): {
  total: number;
  matched: number;
  bothZero: number;
  bothNonZero: number;
  drifted: number;
  errored: number;
} {
  let matched = 0;
  let bothZero = 0;
  let bothNonZero = 0;
  let errored = 0;
  for (const r of results) {
    if (r.error) errored++;
    if (r.comparison.exitCodeMatches) matched++;
    if (r.comparison.bothZero) bothZero++;
    if (r.comparison.bothNonZero) bothNonZero++;
  }
  return {
    total: results.length,
    matched,
    bothZero,
    bothNonZero,
    drifted: results.length - matched,
    errored,
  };
}

export function renderReplayMarkdown(results: ReplayResult[]): string {
  const summary = summarizeReplays(results);
  const lines: string[] = [];
  lines.push(`# bench replay report`);
  lines.push("");
  lines.push(`- total: ${summary.total}`);
  lines.push(`- matched (captured exit === replay exit): ${summary.matched}`);
  lines.push(`- bothZero: ${summary.bothZero}`);
  lines.push(`- bothNonZero: ${summary.bothNonZero}`);
  lines.push(`- drifted: ${summary.drifted}`);
  lines.push(`- errored: ${summary.errored}`);
  lines.push("");
  lines.push(`| runId | taskId | captured | replay | match | error |`);
  lines.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const r of results) {
    lines.push(
      `| ${r.runId.slice(0, 8)} | ${r.taskId.slice(0, 8)} | ${r.captured.exitCode} | ${
        r.replay.exitCode ?? "—"
      } | ${r.comparison.exitCodeMatches ? "✓" : "✗"} | ${r.error ?? ""} |`,
    );
  }
  return lines.join("\n") + "\n";
}
