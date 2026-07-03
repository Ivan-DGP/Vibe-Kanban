import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getDb } from "../db";
import { parkRun, cancelHeadlessRun } from "./headlessClaude";

/**
 * Direct DB-level coverage for the shared parking helper and the parked-run cancel
 * path (no subprocess involved).
 */
describe("parkRun + cancel-while-parked", () => {
  const db = getDb();
  const projectId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const cancelRunId = crypto.randomUUID();

  beforeAll(() => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      projectId,
      "park-test",
      `/tmp/vk-park-${projectId}`,
    );
    db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
      taskId,
      projectId,
      "park task",
    );
    db.prepare(
      `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt)
       VALUES (?, ?, ?, 'headless', 'running', ?)`,
    ).run(runId, taskId, projectId, new Date().toISOString());
    db.prepare(
      `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt, resumeReason, runMode, resumeAttempts)
       VALUES (?, ?, ?, 'auto', 'waiting_limit', ?, 'usage-limit', 'in_place', 1)`,
    ).run(cancelRunId, taskId, projectId, new Date().toISOString());
  });

  afterAll(() => {
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  });

  test("parkRun flips a running row to waiting_limit and persists resume fields", () => {
    const resumeAt = new Date(Date.now() + 3_600_000);
    parkRun({
      runId,
      sessionId: "sess-park",
      summary: "partial work",
      totalCostUsd: 0.05,
      resumeAt,
      reason: "usage-limit",
      worktree: null,
      baselineSha: "abc123",
    });

    const row = db
      .prepare(
        "SELECT status, sessionId, summary, totalCostUsd, resumeAt, resumeReason, resumeAttempts, runMode, baselineSha FROM task_ai_runs WHERE id = ?",
      )
      .get(runId) as Record<string, unknown>;
    expect(row.status).toBe("waiting_limit");
    expect(row.sessionId).toBe("sess-park");
    expect(row.summary).toBe("partial work");
    expect(row.totalCostUsd).toBe(0.05);
    expect(row.resumeAt).toBe(resumeAt.toISOString());
    expect(row.resumeReason).toBe("usage-limit");
    expect(row.resumeAttempts).toBe(1); // 0 + 1
    expect(row.runMode).toBe("in_place"); // worktree null → in_place
    expect(row.baselineSha).toBe("abc123");
  });

  test("parkRun COALESCEs baselineSha (set once) and increments attempts on re-park", () => {
    parkRun({
      runId,
      sessionId: "sess-park",
      summary: "more",
      totalCostUsd: null,
      resumeAt: new Date(Date.now() + 1000),
      reason: "usage-limit",
      worktree: null,
      baselineSha: "DIFFERENT", // must NOT overwrite the existing baseline
    });
    const row = db
      .prepare("SELECT resumeAttempts, baselineSha FROM task_ai_runs WHERE id = ?")
      .get(runId) as Record<string, unknown>;
    expect(row.resumeAttempts).toBe(2);
    expect(row.baselineSha).toBe("abc123"); // unchanged
  });

  test("cancelHeadlessRun cancels a parked (waiting_limit) run", () => {
    expect(cancelHeadlessRun(cancelRunId)).toBe(true);
    const row = db
      .prepare("SELECT status, resumeAt FROM task_ai_runs WHERE id = ?")
      .get(cancelRunId) as { status: string; resumeAt: string | null };
    expect(row.status).toBe("canceled");
    expect(row.resumeAt).toBeNull();
  });

  test("cancelHeadlessRun returns false for an unknown / already-terminal run", () => {
    expect(cancelHeadlessRun("nope-not-real")).toBe(false);
    // already-canceled row is no longer waiting_limit → false
    expect(cancelHeadlessRun(cancelRunId)).toBe(false);
  });
});
