/**
 * Usage-limit auto-resume scheduler.
 *
 * A run that hit the subscription usage limit is parked by spawnHeadlessClaude as
 * status='waiting_limit' with a resumeAt timestamp. This sweeper periodically
 * picks up due parked runs and resumes the SAME Claude session
 * (`claude -p --resume <sessionId>`) in the SAME worktree.
 *
 * Why a setInterval sweeper (not a setTimeout per run): all pending state lives
 * in SQLite, so it is idempotent and restart-safe — a VK restart re-arms pending
 * resumes automatically (same philosophy as markInterruptedRuns). The atomic
 * claim (UPDATE … WHERE status='waiting_limit') guards against double-resume from
 * two overlapping sweeps or two VK processes on the same DB.
 */
import { getDb } from "../db";
import { log } from "../lib/logger";
import { spawnHeadlessClaude, setResumeNudge, isAutoResumeEnabled } from "./headlessClaude";
import { buildSpawnOpts } from "./taskSpawner";

const SWEEP_MS = (() => {
  const n = Number(process.env.VK_RESUME_SWEEP_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
})();
/** Max parked runs claimed per sweep — keeps a backlog from stampeding. */
const BATCH = 5;

interface ParkedRow {
  id: string;
  taskId: string;
  sessionId: string | null;
  worktreeDir: string | null;
  worktreeBranch: string | null;
  runMode: string | null;
  baselineSha: string | null;
  resumeAttempts: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;

export function startResumeScheduler(): void {
  if (timer) return;
  if (!isAutoResumeEnabled()) {
    log("info", "claude", "auto-resume disabled (VK_AUTORESUME_ENABLED); scheduler not started");
    return;
  }
  setResumeNudge(scheduleResume);
  timer = setInterval(() => void sweep(), SWEEP_MS);
  // Never let the sweep timer keep the process (or a test worker) alive.
  (timer as { unref?: () => void }).unref?.();
  void sweep(); // boot sweep == re-arm pending resumes from a prior process
}

export function stopResumeScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  setResumeNudge(null);
}

/** Opportunistic kick (e.g. after a manual "Resume now" or a fresh park). */
export function scheduleResume(): void {
  void sweep();
}

/** Run one sweep of due parked runs. Exported for deterministic testing. */
export async function sweepResumeQueue(): Promise<void> {
  return sweep();
}

async function sweep(): Promise<void> {
  if (sweeping) return; // never overlap sweeps
  sweeping = true;
  try {
    const db = getDb();
    const due = db
      .prepare(
        `SELECT id, taskId, sessionId, worktreeDir, worktreeBranch, runMode, baselineSha, resumeAttempts
         FROM task_ai_runs
         WHERE status = 'waiting_limit' AND resumeAt IS NOT NULL AND resumeAt <= ?
         ORDER BY resumeAt ASC LIMIT ?`,
      )
      .all(new Date().toISOString(), BATCH) as ParkedRow[];

    for (const row of due) {
      // Atomic claim: only one sweep / process can flip the row out of
      // 'waiting_limit', so a run is never resumed twice.
      const claimed = db
        .prepare(
          "UPDATE task_ai_runs SET status = 'running' WHERE id = ? AND status = 'waiting_limit'",
        )
        .run(row.id);
      if (!(claimed as { changes?: number })?.changes) continue;
      // Fire-and-forget; spawnHeadlessClaude acquires its own concurrency slot, so
      // resumes respect CONCURRENCY_CAP + the per-project lock like any other run.
      void resumeOne(row);
    }
  } catch (e) {
    log("error", "claude", "resume sweep failed", { error: String(e) });
  } finally {
    sweeping = false;
  }
}

async function resumeOne(row: ParkedRow): Promise<void> {
  const db = getDb();
  const built = await buildSpawnOpts(row.taskId, row.id);
  if (!built) {
    // Task/project/config vanished — can't resume. Fail the (already-claimed) row
    // so it doesn't loop forever as 'running'.
    db.prepare("UPDATE task_ai_runs SET status = 'failed', finishedAt = ? WHERE id = ?").run(
      new Date().toISOString(),
      row.id,
    );
    log("warn", "claude", "resume aborted: spawn opts unavailable", { runId: row.id });
    return;
  }
  const { cleanup, ...spawnOpts } = built;
  try {
    log("info", "claude", "resuming parked run", {
      runId: row.id,
      taskId: row.taskId,
      attempt: row.resumeAttempts,
      mode: row.runMode,
    });
    await spawnHeadlessClaude({
      ...spawnOpts,
      runId: row.id,
      resumeSessionId: row.sessionId ?? undefined,
      existingWorktree: row.worktreeDir
        ? { dir: row.worktreeDir, branch: row.worktreeBranch ?? "" }
        : null,
      inPlaceResume: row.runMode === "in_place",
      baselineSha: row.baselineSha,
      resumeAttempts: row.resumeAttempts,
      // --resume restores the full conversation; a short nudge is enough.
      prompt: "Continue the task where you left off.",
    });
  } catch (e) {
    // The row is 'running' now; the boot reconcile re-arms it if the process died.
    log("error", "claude", "resume failed", { runId: row.id, error: String(e) });
  } finally {
    cleanup();
  }
}
