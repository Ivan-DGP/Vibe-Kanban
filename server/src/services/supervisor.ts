// Phase 3 orchestrator for the propose-only supervisor: collect signals → rank +
// ground → emit as idempotent backlog tasks. Its ONLY side effect is creating
// backlog tasks tagged `metadata.origin='supervisor'`; it never dispatches AI
// runs or changes code. Idempotent: a task is created at most once per signalKey.

import { getDb } from "../db";
import { collectSignals } from "./supervisorSignals";
import { buildProposals } from "./supervisorProposals";
import { refineProposals } from "./supervisorSynthesis";
import type { SupervisorProposal } from "./supervisorProposals";
import type { EmbedFn } from "./memorySearch";

export interface EmittedProposal extends SupervisorProposal {
  /** The backlog task carrying this proposal (existing or newly created). */
  taskId: string;
  /** True when this scan created the task; false when it already existed. */
  created: boolean;
}

export interface ScanOptions {
  limit?: number;
  embedFn?: EmbedFn;
}

export interface ScanResult {
  created: number;
  skipped: number;
  proposals: EmittedProposal[];
}

/**
 * Run a full supervisor scan: collect cross-project signals, rank + ground them,
 * and emit each proposal as a backlog task — skipping any whose `signalKey`
 * already has a task (idempotent across re-scans). Returns the emitted proposals
 * with their task ids.
 */
export async function runScan(opts: ScanOptions = {}): Promise<ScanResult> {
  const db = getDb();
  const findExisting = db.prepare(
    "SELECT id FROM tasks WHERE json_extract(metadata, '$.signalKey') = ? LIMIT 1",
  );

  // Dedup BEFORE ranking/limiting: drop signals already emitted as tasks so a
  // re-scan surfaces the NEXT batch of un-proposed work rather than plateauing on
  // the same top-N. (Without this, once the top `limit` persist, every later scan
  // re-ranks them and creates nothing until they're cleared.)
  const fresh = collectSignals().filter((s) => !findExisting.get(s.signalKey));
  const ranked = await buildProposals(fresh, { limit: opts.limit, embedFn: opts.embedFn });
  // Optional LLM pass to sharpen each rationale — opt-in (default OFF) and a
  // pure refinement: falls back to the deterministic rationale on any failure.
  const proposals = refineProposals(ranked);

  let created = 0;
  let skipped = 0;
  const emitted: EmittedProposal[] = [];
  for (const p of proposals) {
    // Re-check existence at emit time — belt-and-suspenders against a concurrent
    // scan that created the same task between the pre-filter and here.
    const existing = findExisting.get(p.signalKey) as { id: string } | null;
    if (existing) {
      skipped++;
      emitted.push({ ...p, taskId: existing.id, created: false });
      continue;
    }
    const taskId = createProposalTask(p);
    created++;
    emitted.push({ ...p, taskId, created: true });
  }
  return { created, skipped, proposals: emitted };
}

/** Insert a backlog task for a proposal. Mirrors the task-create route's
 * taskNumber/sortOrder sequencing; rationale becomes the description; the signal
 * is tagged in metadata for idempotency + later curation. */
function createProposalTask(p: SupervisorProposal): string {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const maxOrder = (
    db
      .prepare("SELECT MAX(sortOrder) AS m FROM tasks WHERE projectId = ? AND status = 'backlog'")
      .get(p.projectId) as { m: number | null }
  ).m;
  const maxNum = (
    db.prepare("SELECT MAX(taskNumber) AS m FROM tasks WHERE projectId = ?").get(p.projectId) as {
      m: number | null;
    }
  ).m;

  const metadata = JSON.stringify({
    origin: "supervisor",
    signalKey: p.signalKey,
    signalType: p.signalType,
    score: p.score,
  });

  db.prepare(
    `INSERT INTO tasks (id, projectId, title, description, status, priority, taskNumber, sortOrder, inboxAt, metadata, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'backlog', 'medium', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    p.projectId,
    p.title,
    p.rationale,
    (maxNum ?? 0) + 1,
    (maxOrder ?? 0) + 1,
    now, // inboxAt — backlog entry
    metadata,
    now,
    now,
  );
  return id;
}
