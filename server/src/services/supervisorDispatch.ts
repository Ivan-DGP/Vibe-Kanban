// Phase 4 of the supervisor: DISPATCH an approved proposal into the EXISTING
// headless runner — the propose→execute jump, behind hard human-approval gating.
//
// Safety model (belt-and-suspenders; nothing runs without deliberate human action):
//  1. Master switch VK_SUPERVISOR_DISPATCH_ENABLED (default OFF) — disabled → refused.
//  2. Per-proposal, human-initiated only (the POST /dispatch call IS the approval).
//     runScan stays strictly propose-only — there is no auto/batch dispatch.
//  3. Guards: supervisor-origin only; idempotent (no double-run); not if a run is
//     already in flight.
//
// Execution reuses spawnHeadlessClaude UNTOUCHED: isolated throwaway git worktree,
// adversarial verifiers, task_ai_runs — and it NEVER auto-merges. Blast radius is
// bounded to the worktree; the human reviews the run. The run's deviations/failures
// auto-capture into memory (memory mission), feeding future supervisor grounding.

import { getDb } from "../db";
import { spawnHeadlessClaude, hasRunningRun } from "./headlessClaude";
import { buildSpawnOpts } from "./taskSpawner";
import { applyTimestampCascade } from "./taskModel";
import { log } from "../lib/logger";
import type { Task } from "@vibe-kanban/shared";

export type DispatchReason =
  | "disabled"
  | "not_found"
  | "not_supervisor"
  | "run_in_flight"
  | "assemble_failed"
  | "error";

export interface DispatchResult {
  ok: boolean;
  runId?: string;
  reason?: DispatchReason;
  /** True when the proposal was already dispatched (returns the prior runId). */
  alreadyDispatched?: boolean;
}

/** Master switch. Read at call time so operators (and tests) can toggle it. */
export function isDispatchEnabled(): boolean {
  const v = process.env.VK_SUPERVISOR_DISPATCH_ENABLED;
  return v === "true" || v === "1";
}

function safeParseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Dispatch one supervisor proposal into the headless runner. Returns a result;
 * never throws into the caller. The ONLY side effects are: stamping the task's
 * metadata + moving it backlog→in_progress, and firing a background headless run
 * (isolated worktree, no merge).
 */
export async function dispatchProposal(taskId: string): Promise<DispatchResult> {
  // 1. Master switch — default OFF. Nothing runs unless explicitly enabled.
  if (!isDispatchEnabled()) return { ok: false, reason: "disabled" };

  try {
    const db = getDb();
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return { ok: false, reason: "not_found" };

    const metadata = safeParseMeta(row.metadata);
    // 2. Supervisor-origin only.
    if (metadata.origin !== "supervisor") return { ok: false, reason: "not_supervisor" };

    // 3a. Fast path — clearly already dispatched → return the prior runId.
    if (typeof metadata.dispatchedRunId === "string" && metadata.dispatchedRunId) {
      return { ok: true, runId: metadata.dispatchedRunId, alreadyDispatched: true };
    }
    // 3b. Don't dispatch on top of an in-flight run for this task.
    if (hasRunningRun(taskId)) return { ok: false, reason: "run_in_flight" };

    const runId = crypto.randomUUID();

    // Assemble spawn opts (async: writes a per-run MCP config). Done BEFORE the
    // atomic claim so the claim itself has no await inside it.
    let built;
    try {
      built = await buildSpawnOpts(taskId, runId);
    } catch (err) {
      log("error", "claude", `supervisor dispatch assemble failed`, {
        taskId,
        runId,
        error: String(err),
      });
      return { ok: false, reason: "assemble_failed" };
    }
    if (!built) return { ok: false, reason: "assemble_failed" };
    const { cleanup, ...spawnOpts } = built;

    // ── Atomic claim ──────────────────────────────────────────────────────────
    // A single synchronous conditional UPDATE: only the call that flips
    // dispatchedRunId (from absent) wins. bun:sqlite is synchronous, so with no
    // await between the guard reads above and this CAS, two concurrent dispatches
    // for the same task can never BOTH pass — exactly one gets changes===1. Closes
    // the double-run window that a read-then-later-stamp would leave open.
    const now = new Date().toISOString();
    const newMeta = JSON.stringify({ ...metadata, dispatchedRunId: runId, dispatchedAt: now });
    const cascade = applyTimestampCascade(row as Partial<Task>, "in_progress");
    const claim = db
      .prepare(
        `UPDATE tasks
           SET status = 'in_progress', metadata = ?, updatedAt = ?,
               inboxAt = COALESCE(inboxAt, ?), inProgressAt = COALESCE(inProgressAt, ?)
         WHERE id = ? AND json_extract(metadata, '$.dispatchedRunId') IS NULL`,
      )
      .run(newMeta, cascade.updatedAt, cascade.inboxAt ?? now, cascade.inProgressAt ?? now, taskId);

    if (claim.changes === 0) {
      // Lost the claim (a concurrent call won, or it was dispatched meanwhile).
      // Discard our unused MCP config and report the winner's runId — no spawn.
      cleanup();
      const cur = safeParseMeta(
        (db.prepare("SELECT metadata FROM tasks WHERE id = ?").get(taskId) as { metadata?: string })
          ?.metadata,
      );
      const winnerRunId = typeof cur.dispatchedRunId === "string" ? cur.dispatchedRunId : undefined;
      return { ok: true, runId: winnerRunId, alreadyDispatched: true };
    }

    // Won the claim — fire the run in the background. spawnHeadlessClaude isolates
    // it in a throwaway worktree, runs verifiers, records task_ai_runs, and NEVER
    // merges. Observable via /claude/runs + /tasks/:taskId/ai-runs.
    void spawnHeadlessClaude({ ...spawnOpts, runId })
      .catch((err) =>
        log("error", "claude", `supervisor dispatch run failed`, {
          taskId,
          runId,
          error: String(err),
        }),
      )
      .finally(cleanup);

    return { ok: true, runId };
  } catch (err) {
    // Never throw into the caller.
    log("error", "claude", `supervisor dispatch error`, { taskId, error: String(err) });
    return { ok: false, reason: "error" };
  }
}
