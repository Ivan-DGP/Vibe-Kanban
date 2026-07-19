import { getDb } from "../db";
import { appendMemory } from "./projectMemory";
import { log } from "../lib/logger";
import type { MemoryType } from "@vibe-kanban/shared";

// Material-only capture: an event must clear this many trimmed chars to be worth
// storing. Filters out trivial "ok"/"done" noise that would only bloat the
// eventual <project_memory> injection block.
const MIN_MATERIAL_CHARS = 40;

// The usage-limit give-up summary (see headlessClaude.ts) is a FAILED run whose
// "failure" is infrastructure exhaustion, not a failed approach to the problem.
// Capturing it as attempt_failed would inject a false "this was tried and failed"
// signal into future prompts, so it's excluded. Degrades gracefully: if the
// wording changes, such a run just falls back to being captured like any other.
const USAGE_LIMIT_GIVEUP = /auto-resume gave up/i;

interface RunRow {
  summary: string | null;
  deviations: string | null;
  status: string | null;
}

/** First non-empty line of `text`, trimmed to a human-scannable title length. */
function deriveTitle(text: string): string {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const base = (firstLine ?? text.trim()).slice(0, 120);
  return base.length > 0 ? base : "(untitled)";
}

/** True when a non-superseded event with the same type + identical body already
 * exists for this project — dedupes re-runs that log the same deviation/summary. */
function isDuplicate(projectId: string, type: MemoryType, body: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 FROM project_memory WHERE projectId = ? AND type = ? AND body = ? AND supersededBy IS NULL LIMIT 1",
    )
    .get(projectId, type, body) as { 1: number } | null;
  // bun:sqlite .get() returns null (not undefined) on no match — use a nullish
  // check, not `!== undefined`, or every lookup would read as a duplicate.
  return row != null;
}

/** A capture candidate — body is required here (unlike CreateMemoryInput). */
interface MemoryCandidate {
  type: MemoryType;
  title: string;
  body: string;
}

/**
 * Auto-capture memory events from a just-finalized AI run. Material-only:
 * - `deviations` (an explicit "how I diverged" log) → a `gotcha` event.
 * - the `summary` of a FAILED run → an `attempt_failed` event (so future runs
 *   know this approach was tried and failed). Success summaries are intentionally
 *   NOT captured (low unique signal, high noise).
 *
 * Deduped by exact body per (project, type). NEVER throws — capture failures must
 * not affect the run that triggered it. Call after the run row is finalized.
 */
export function captureMemoryFromRun(input: {
  runId: string;
  taskId: string | null;
  projectId: string;
}): void {
  try {
    const { runId, taskId, projectId } = input;
    if (!projectId) return;

    const run = getDb()
      .prepare("SELECT summary, deviations, status FROM task_ai_runs WHERE id = ?")
      .get(runId) as RunRow | undefined;
    if (!run) return;

    const candidates: MemoryCandidate[] = [];

    // Deviations → gotcha. Stored as JSON { notes, artifactId } by
    // record_run_deviations; the free-text signal lives in `notes`.
    if (run.deviations) {
      let notes = "";
      try {
        const parsed = JSON.parse(run.deviations) as { notes?: string };
        notes = typeof parsed.notes === "string" ? parsed.notes.trim() : "";
      } catch {
        notes = "";
      }
      if (notes.length >= MIN_MATERIAL_CHARS) {
        candidates.push({ type: "gotcha", title: deriveTitle(notes), body: notes });
      }
    }

    // Failed run's summary → attempt_failed (excluding usage-limit give-ups,
    // which are not real failed approaches).
    if (run.status === "failed" && run.summary && !USAGE_LIMIT_GIVEUP.test(run.summary)) {
      const summary = run.summary.trim();
      if (summary.length >= MIN_MATERIAL_CHARS) {
        candidates.push({ type: "attempt_failed", title: deriveTitle(summary), body: summary });
      }
    }

    for (const c of candidates) {
      if (isDuplicate(projectId, c.type, c.body)) continue;
      appendMemory({
        projectId,
        type: c.type,
        title: c.title,
        body: c.body,
        taskId: taskId ?? null,
        runId,
        origin: "ai_captured",
      });
    }
  } catch (err) {
    log(
      "error",
      "server",
      `memory auto-capture failed for run ${input.runId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
