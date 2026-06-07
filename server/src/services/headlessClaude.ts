import { spawnProcess } from "../lib/runtime";
import { getDb } from "../db";
import { log } from "../lib/logger";
import { captureTaskAiRun } from "./taskAiCapture";
import {
  loadPolicy,
  recordFindings,
  runProductionVerifiers,
  snapshotPreSpawn,
  type PreSpawnSnapshot,
} from "./headlessClaudeAdversarial";
import {
  createRunWorktree,
  finalizeWorktreeSuccess,
  discardWorktree,
  type RunWorktree,
} from "./worktree";
import { setRunCwd, clearRunCwd } from "./runContext";

export interface HeadlessClaudeOptions {
  prompt: string;
  taskId: string;
  projectId: string;
  mcpConfigPath: string;
  cwd: string;
  profile?: string;
  timeoutMs?: number;
  /**
   * Caller-supplied run id. Lets a pre-spawn step (e.g. preflight test
   * runner) record `task_ai_findings` under the same id used to persist
   * `task_ai_runs`, so findings and the run row are joinable. Falls back
   * to a fresh UUID when omitted.
   */
  runId?: string;
}

export interface HeadlessClaudeResult {
  exitCode: number;
  summary: string | null;
  sessionId: string | null;
  durationMs: number;
  runId: string;
}

const DEFAULT_TIMEOUT_MS = (() => {
  const fromEnv = Number(process.env.VK_HEADLESS_CLAUDE_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 15 * 60 * 1000;
})();
const CONCURRENCY_CAP = (() => {
  const fromEnv = Number(process.env.VK_HEADLESS_CLAUDE_CONCURRENCY);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 3;
})();

let inFlight = 0;
const queue: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < CONCURRENCY_CAP) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  inFlight++;
}

function releaseSlot(): void {
  inFlight--;
  const next = queue.shift();
  if (next) next();
}

export function getHeadlessClaudeStats(): {
  inFlight: number;
  queued: number;
  cap: number;
  active: number;
} {
  return { inFlight, queued: queue.length, cap: CONCURRENCY_CAP, active: activeRuns.size };
}

// ── Per-project serialization ─────────────────────────────────
// Only one headless run per project executes at a time, so two autonomous
// agents can't mutate the same working tree concurrently and corrupt git state.
// (Acquired BEFORE the global slot so a waiting run doesn't hold a slot idle.)
const projectTail = new Map<string, Promise<void>>();

async function acquireProjectLock(projectId: string): Promise<() => void> {
  const prev = projectTail.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  projectTail.set(
    projectId,
    prev.then(() => next),
  );
  await prev.catch(() => {});
  return release;
}

// ── Active run registry (for cancellation) ────────────────────
interface ActiveRun {
  controller: AbortController;
  taskId: string;
  projectId: string;
  startedAt: number;
}
const activeRuns = new Map<string, ActiveRun>();

/** Cancel an in-flight run by id. Returns false if no such run is active. */
export function cancelHeadlessRun(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (!run) return false;
  log("info", "claude", "headless run cancel requested", { runId, taskId: run.taskId });
  run.controller.abort();
  return true;
}

export function listActiveRuns(): {
  runId: string;
  taskId: string;
  projectId: string;
  startedAt: string;
}[] {
  return Array.from(activeRuns.entries()).map(([runId, r]) => ({
    runId,
    taskId: r.taskId,
    projectId: r.projectId,
    startedAt: new Date(r.startedAt).toISOString(),
  }));
}

/** Abort every in-flight run (used on server shutdown). */
export function cancelAllHeadlessRuns(): void {
  for (const r of activeRuns.values()) r.controller.abort();
}

/**
 * On boot, any run still marked 'running' was interrupted by a previous crash/
 * restart — there is no live process for it. Mark such rows failed so the UI and
 * the double-spawn guard don't treat them as live forever.
 */
export function markInterruptedRuns(): void {
  try {
    const db = getDb();
    const res = db
      .prepare("UPDATE task_ai_runs SET status = 'failed', finishedAt = ? WHERE status = 'running'")
      .run(new Date().toISOString());
    const changes = (res as any)?.changes ?? 0;
    if (changes > 0) log("warn", "claude", `marked ${changes} interrupted task_ai_run(s) failed`);
  } catch (e) {
    log("error", "claude", "failed to reconcile interrupted runs", { error: String(e) });
  }
}

/** True if a run for this task is currently recorded as 'running'. */
export function hasRunningRun(taskId: string): boolean {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT 1 FROM task_ai_runs WHERE taskId = ? AND status = 'running' LIMIT 1")
      .get(taskId);
    return !!row;
  } catch {
    return false;
  }
}

export interface ParsedClaudeJson {
  sessionId: string | null;
  summary: string | null;
}

export function parseClaudeOutput(stdout: string): ParsedClaudeJson {
  const trimmed = stdout.trim();
  if (!trimmed) return { sessionId: null, summary: null };

  try {
    const parsed = JSON.parse(trimmed);
    return {
      sessionId: parsed.session_id ?? parsed.sessionId ?? null,
      summary: parsed.result ?? parsed.summary ?? null,
    };
  } catch {
    // Streaming-JSON or partial output — try to recover the last well-formed object.
    const lines = trimmed.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed.session_id || parsed.result) {
          return {
            sessionId: parsed.session_id ?? null,
            summary: parsed.result ?? null,
          };
        }
      } catch {
        // keep scanning
      }
    }
    return { sessionId: null, summary: trimmed.slice(-1000) };
  }
}

/** Extract the run cost (USD) from Claude CLI JSON output, or null. */
export function parseClaudeCost(stdout: string): number | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const fromObj = (s: string): number | null => {
    try {
      const p = JSON.parse(s);
      const c = p.total_cost_usd ?? p.totalCostUsd ?? p.cost_usd ?? p.costUsd;
      return typeof c === "number" && Number.isFinite(c) ? c : null;
    } catch {
      return null;
    }
  };
  const whole = fromObj(trimmed);
  if (whole !== null) return whole;
  const lines = trimmed.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const c = fromObj(lines[i]);
    if (c !== null) return c;
  }
  return null;
}

export async function spawnHeadlessClaude(
  opts: HeadlessClaudeOptions,
): Promise<HeadlessClaudeResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const profile = opts.profile ?? "headless";
  const runId = opts.runId ?? crypto.randomUUID();

  await acquireSlot();
  const started = Date.now();
  const controller = new AbortController();
  activeRuns.set(runId, {
    controller,
    taskId: opts.taskId,
    projectId: opts.projectId,
    startedAt: started,
  });

  let preSnapshot: PreSpawnSnapshot = { preSha: null };
  // Isolate the run in a git worktree when possible. If not (non-git project,
  // worktrees disabled, or git failure), fall back to in-place execution and
  // serialize per-project so concurrent agents can't stomp the shared tree.
  let worktree: RunWorktree | null = null;
  let releaseProject: (() => void) | null = null;
  let runCwd = opts.cwd;

  // Insert the run row as 'running' up front so it's visible/recoverable while
  // the (possibly long) process executes.
  try {
    getDb()
      .prepare(
        `INSERT INTO task_ai_runs (id, taskId, projectId, profile, complexity, status, startedAt)
         VALUES (?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(runId, opts.taskId, opts.projectId, profile, "medium", new Date(started).toISOString());
  } catch (e) {
    log("error", "claude", `failed to insert running task_ai_run`, { runId, error: String(e) });
  }

  try {
    worktree = await createRunWorktree({
      projectPath: opts.cwd,
      projectId: opts.projectId,
      taskId: opts.taskId,
      runId,
    });
    if (worktree) {
      runCwd = worktree.dir;
    } else {
      // In-place fallback: serialize runs for this project.
      releaseProject = await acquireProjectLock(opts.projectId);
      runCwd = opts.cwd;
    }
    // Expose this run's cwd so the per-run MCP endpoint scopes git tools to it.
    setRunCwd(runId, runCwd);

    preSnapshot = await snapshotPreSpawn(runCwd);

    const cmd = [
      "claude",
      "-p",
      "--output-format",
      "json",
      "--mcp-config",
      opts.mcpConfigPath,
      "--dangerously-skip-permissions",
      opts.prompt,
    ];

    log("info", "claude", `headless claude spawn`, {
      runId,
      taskId: opts.taskId,
      projectId: opts.projectId,
      profile,
      isolated: !!worktree,
    });

    const result = await spawnProcess(cmd, {
      cwd: runCwd,
      timeout: timeoutMs,
      signal: controller.signal,
    });

    const durationMs = Date.now() - started;
    const { sessionId, summary } = parseClaudeOutput(result.stdout);
    const totalCostUsd = parseClaudeCost(result.stdout);
    const canceled = controller.signal.aborted;
    const success = !canceled && result.exitCode === 0 ? 1 : 0;
    const status = canceled ? "canceled" : result.exitCode === 0 ? "succeeded" : "failed";

    try {
      const db = getDb();
      db.prepare(
        `UPDATE task_ai_runs
         SET sessionId = ?, exitCode = ?, success = ?, durationMs = ?, summary = ?,
             status = ?, finishedAt = ?, totalCostUsd = ?
         WHERE id = ?`,
      ).run(
        sessionId,
        result.exitCode,
        success,
        durationMs,
        summary,
        status,
        new Date().toISOString(),
        totalCostUsd,
        runId,
      );
    } catch (e) {
      log("error", "claude", `failed to finalize task_ai_run`, { runId, error: String(e) });
    }

    // Capture + adversarial verification run against the run's cwd (the worktree
    // when isolated). For isolated runs we must keep the worktree alive until they
    // finish, so await them before tearing it down.
    const captureP = captureTaskAiRun({
      runId,
      taskId: opts.taskId,
      projectId: opts.projectId,
      cwd: runCwd,
      exitCode: result.exitCode,
      durationMs,
      summary,
      sessionId,
    }).catch(() => undefined);

    const verifyP = runProductionVerifiers({
      runId,
      taskId: opts.taskId,
      projectId: opts.projectId,
      cwd: runCwd,
      summary,
      pre: preSnapshot,
      policy: loadPolicy(opts.projectId, opts.taskId),
    })
      .then((findings) => {
        recordFindings({ runId, taskId: opts.taskId, projectId: opts.projectId, findings });
      })
      .catch(() => undefined);

    if (worktree) {
      await Promise.allSettled([captureP, verifyP]);
      if (success === 1) {
        await finalizeWorktreeSuccess({
          projectPath: opts.cwd,
          projectId: opts.projectId,
          dir: worktree.dir,
          branch: worktree.branch,
          taskId: opts.taskId,
          runId,
        });
      } else {
        await discardWorktree({
          projectPath: opts.cwd,
          projectId: opts.projectId,
          dir: worktree.dir,
          branch: worktree.branch,
        });
      }
      worktree = null; // handled — finally must not double-discard
    } else {
      void captureP;
      void verifyP;
    }

    if (result.exitCode !== 0) {
      log("warn", "claude", `headless claude non-zero exit`, {
        runId,
        exitCode: result.exitCode,
        stderr: result.stderr.slice(-500),
      });
    }

    return { exitCode: result.exitCode, summary, sessionId, durationMs, runId };
  } finally {
    // If an exception bypassed normal teardown, discard the worktree (rollback).
    if (worktree) {
      await discardWorktree({
        projectPath: opts.cwd,
        projectId: opts.projectId,
        dir: worktree.dir,
        branch: worktree.branch,
      }).catch(() => undefined);
    }
    clearRunCwd(runId);
    activeRuns.delete(runId);
    releaseSlot();
    if (releaseProject) releaseProject();
  }
}
