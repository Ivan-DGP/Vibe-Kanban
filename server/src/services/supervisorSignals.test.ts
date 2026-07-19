import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import crypto from "node:crypto";
import { getDb } from "../db";
import { collectSignals } from "./supervisorSignals";

const P1 = `__sup_sig_1_${crypto.randomUUID()}__`;
const P2 = `__sup_sig_2_${crypto.randomUUID()}__`;

// Refs we seed, so we assert on membership (collectSignals is global and may see
// other rows in the shared test DB).
const ids = {
  roadmapUnlinked: crypto.randomUUID(),
  roadmapLinked: crypto.randomUUID(),
  roadmapCompleted: crypto.randomUUID(),
  linkedTask: crypto.randomUUID(),
  findingSec: crypto.randomUUID(),
  findingQual: crypto.randomUUID(),
  findingTask: crypto.randomUUID(),
  stalledTask: crypto.randomUUID(),
  freshTask: crypto.randomUUID(),
  unresolvedMem: crypto.randomUUID(),
  supersededMem: crypto.randomUUID(),
  replacementMem: crypto.randomUUID(),
};

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  for (const p of [P1, P2]) {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(p, p, `/tmp/${p}`);
  }

  // Roadmap: one unlinked (signal), one linked to a task (NOT a signal).
  const roadmap = (id: string, pid: string, title: string) =>
    db
      .prepare("INSERT INTO roadmap_items (id, projectId, title, createdAt) VALUES (?, ?, ?, ?)")
      .run(id, pid, title, now);
  roadmap(ids.roadmapUnlinked, P1, "Unlinked roadmap item");
  roadmap(ids.roadmapLinked, P2, "Linked roadmap item");
  // Completed item with no task — must NOT be proposed (not planned work).
  db.prepare(
    "INSERT INTO roadmap_items (id, projectId, title, status, createdAt) VALUES (?, ?, ?, 'completed', ?)",
  ).run(ids.roadmapCompleted, P1, "Done roadmap item", now);
  db.prepare("INSERT INTO tasks (id, projectId, title, status) VALUES (?, ?, ?, 'todo')").run(
    ids.linkedTask,
    P2,
    "task for roadmap",
  );
  db.prepare("INSERT INTO roadmap_item_tasks (roadmapItemId, taskId) VALUES (?, ?)").run(
    ids.roadmapLinked,
    ids.linkedTask,
  );

  // Findings: one security kind, one quality kind (each needs a task).
  db.prepare("INSERT INTO tasks (id, projectId, title, status) VALUES (?, ?, ?, 'done')").run(
    ids.findingTask,
    P1,
    "finding task",
  );
  const finding = (id: string, kind: string) =>
    db
      .prepare(
        "INSERT INTO task_ai_findings (id, runId, taskId, projectId, kind, detail, createdAt) VALUES (?, 'run1', ?, ?, ?, ?, ?)",
      )
      .run(id, ids.findingTask, P1, kind, `${kind} detail`, now);
  finding(ids.findingSec, "EXFIL");
  finding(ids.findingQual, "SPRAWL");

  // Tasks in_progress: one stalled (old), one fresh (NOT a signal).
  db.prepare(
    "INSERT INTO tasks (id, projectId, title, status, inProgressAt) VALUES (?, ?, ?, 'in_progress', ?)",
  ).run(ids.stalledTask, P2, "Stalled task", daysAgo(30));
  db.prepare(
    "INSERT INTO tasks (id, projectId, title, status, inProgressAt) VALUES (?, ?, ?, 'in_progress', ?)",
  ).run(ids.freshTask, P2, "Fresh task", daysAgo(0));

  // Memory: one unresolved attempt_failed, one superseded (NOT a signal).
  const mem = (id: string, superseded: string | null) =>
    db
      .prepare(
        "INSERT INTO project_memory (id, projectId, type, title, body, origin, supersededBy, createdAt) VALUES (?, ?, 'attempt_failed', ?, 'body', 'ai_captured', ?, ?)",
      )
      .run(id, P1, `mem ${id.slice(0, 4)}`, superseded, now);
  mem(ids.replacementMem, null);
  mem(ids.unresolvedMem, null);
  mem(ids.supersededMem, ids.replacementMem);
});

afterAll(() => {
  const db = getDb();
  for (const p of [P1, P2]) {
    db.prepare("DELETE FROM task_ai_findings WHERE projectId = ?").run(p);
    db.prepare(
      "DELETE FROM roadmap_item_tasks WHERE roadmapItemId IN (SELECT id FROM roadmap_items WHERE projectId = ?)",
    ).run(p);
    db.prepare("DELETE FROM roadmap_items WHERE projectId = ?").run(p);
    db.prepare("DELETE FROM project_memory WHERE projectId = ?").run(p);
    db.prepare("DELETE FROM tasks WHERE projectId = ?").run(p);
    db.prepare("DELETE FROM projects WHERE id = ?").run(p);
  }
});

describe("collectSignals", () => {
  test("collects each cross-project signal kind with a stable signalKey", () => {
    const keys = new Set(collectSignals().map((s) => s.signalKey));
    expect(keys.has(`roadmap:${ids.roadmapUnlinked}`)).toBe(true);
    expect(keys.has(`finding:${ids.findingSec}`)).toBe(true);
    expect(keys.has(`finding:${ids.findingQual}`)).toBe(true);
    expect(keys.has(`stalled:${ids.stalledTask}`)).toBe(true);
    expect(keys.has(`unresolved:${ids.unresolvedMem}`)).toBe(true);
  });

  test("excludes: linked roadmap item, fresh in_progress task, superseded failure", () => {
    const keys = new Set(collectSignals().map((s) => s.signalKey));
    expect(keys.has(`roadmap:${ids.roadmapLinked}`)).toBe(false);
    expect(keys.has(`roadmap:${ids.roadmapCompleted}`)).toBe(false); // not 'planned'
    expect(keys.has(`stalled:${ids.freshTask}`)).toBe(false);
    expect(keys.has(`unresolved:${ids.supersededMem}`)).toBe(false);
  });

  test("security findings outweigh quality findings; carries projectId", () => {
    const byKey = new Map(collectSignals().map((s) => [s.signalKey, s]));
    const sec = byKey.get(`finding:${ids.findingSec}`)!;
    const qual = byKey.get(`finding:${ids.findingQual}`)!;
    expect(sec.weightHint).toBeGreaterThan(qual.weightHint);
    expect(sec.type).toBe("finding");
    expect(sec.projectId).toBe(P1);
  });
});
