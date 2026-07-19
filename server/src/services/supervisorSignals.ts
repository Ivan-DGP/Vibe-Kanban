// Cross-project signal collection for the propose-only supervisor. Deterministic
// (no LLM): scans ALL projects for candidate work — planned-but-unstarted roadmap
// items, unaddressed adversarial findings, stalled in-progress tasks, and
// unresolved failed approaches — and returns structured signals with a stable
// `signalKey` for idempotent proposal dedup downstream.

import { getDb } from "../db";

export type SupervisorSignalType = "roadmap" | "finding" | "stalled" | "unresolved";

export interface SupervisorSignal {
  type: SupervisorSignalType;
  projectId: string;
  /** Source row id (roadmap item / finding / task / memory event). */
  ref: string;
  title: string;
  detail: string | null;
  /** Stable dedup key, e.g. "roadmap:<id>". Proposals never re-created for it. */
  signalKey: string;
  /** Base value hint; ranking (Phase 2) refines this. */
  weightHint: number;
}

// A task counts as "stalled" after this many days in `in_progress`.
const STALLED_DAYS = (() => {
  const raw = parseInt(process.env.VK_SUPERVISOR_STALLED_DAYS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 7;
})();

// Bound each query so a huge history can't produce an unbounded scan.
const PER_SIGNAL_LIMIT = 500;

// Security-relevant finding kinds outrank quality ones.
const SECURITY_FINDING_KINDS = new Set(["EXFIL", "PROMPT-INJECTED", "TAMPERED"]);

const WEIGHT = {
  findingSecurity: 100,
  unresolved: 70,
  findingQuality: 60,
  roadmap: 50,
  stalled: 40,
} as const;

/**
 * Collect cross-project candidate signals. Read-only; never throws on an empty
 * corpus. Ordering within a type is newest-first so the per-type LIMIT keeps the
 * most recent candidates.
 */
export function collectSignals(): SupervisorSignal[] {
  const db = getDb();
  const signals: SupervisorSignal[] = [];

  // 1. Roadmap items that are still 'planned' with NO linked task — actionable,
  //    unstarted work. Excludes in_progress/completed/blocked (not ready work).
  const roadmap = db
    .prepare(
      `SELECT r.id, r.projectId, r.title
         FROM roadmap_items r
         LEFT JOIN roadmap_item_tasks rt ON rt.roadmapItemId = r.id
        WHERE rt.roadmapItemId IS NULL AND r.status = 'planned'
        ORDER BY r.createdAt DESC
        LIMIT ?`,
    )
    .all(PER_SIGNAL_LIMIT) as { id: string; projectId: string; title: string }[];
  for (const r of roadmap) {
    signals.push({
      type: "roadmap",
      projectId: r.projectId,
      ref: r.id,
      title: r.title,
      detail: "Planned roadmap item with no task yet.",
      signalKey: `roadmap:${r.id}`,
      weightHint: WEIGHT.roadmap,
    });
  }

  // 2. Adversarial findings — unaddressed security/quality issues from AI runs.
  const findings = db
    .prepare(
      `SELECT id, projectId, kind, detail
         FROM task_ai_findings
        ORDER BY createdAt DESC
        LIMIT ?`,
    )
    .all(PER_SIGNAL_LIMIT) as {
    id: string;
    projectId: string;
    kind: string;
    detail: string | null;
  }[];
  for (const f of findings) {
    const security = SECURITY_FINDING_KINDS.has(f.kind);
    signals.push({
      type: "finding",
      projectId: f.projectId,
      ref: f.id,
      title: `Address ${f.kind} finding`,
      detail: f.detail,
      signalKey: `finding:${f.id}`,
      weightHint: security ? WEIGHT.findingSecurity : WEIGHT.findingQuality,
    });
  }

  // 3. Stalled tasks — stuck in in_progress past the threshold.
  const cutoff = new Date(Date.now() - STALLED_DAYS * 86_400_000).toISOString();
  const stalled = db
    .prepare(
      `SELECT id, projectId, title, inProgressAt
         FROM tasks
        WHERE status = 'in_progress' AND inProgressAt IS NOT NULL AND inProgressAt < ?
        ORDER BY inProgressAt ASC
        LIMIT ?`,
    )
    .all(cutoff, PER_SIGNAL_LIMIT) as {
    id: string;
    projectId: string;
    title: string;
    inProgressAt: string;
  }[];
  for (const t of stalled) {
    signals.push({
      type: "stalled",
      projectId: t.projectId,
      ref: t.id,
      title: `Unstick: ${t.title}`,
      detail: `In progress since ${t.inProgressAt} (> ${STALLED_DAYS}d).`,
      signalKey: `stalled:${t.id}`,
      weightHint: WEIGHT.stalled,
    });
  }

  // 4. Unresolved failed approaches — attempt_failed memory not yet superseded.
  const unresolved = db
    .prepare(
      `SELECT id, projectId, title, body
         FROM project_memory
        WHERE type = 'attempt_failed' AND supersededBy IS NULL
        ORDER BY createdAt DESC
        LIMIT ?`,
    )
    .all(PER_SIGNAL_LIMIT) as { id: string; projectId: string; title: string; body: string }[];
  for (const m of unresolved) {
    signals.push({
      type: "unresolved",
      projectId: m.projectId,
      ref: m.id,
      title: `Revisit failed approach: ${m.title}`,
      detail: m.body || null,
      signalKey: `unresolved:${m.id}`,
      weightHint: WEIGHT.unresolved,
    });
  }

  return signals;
}
