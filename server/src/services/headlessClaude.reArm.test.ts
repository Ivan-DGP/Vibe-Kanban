import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getDb } from "../db";
import { markInterruptedRuns, getResumeMaxAttempts } from "./headlessClaude";

/**
 * Boot reconcile (markInterruptedRuns) must RE-ARM an interrupted resume back to
 * 'waiting_limit' (so the boot sweep retries it and its worktree isn't leaked),
 * while still failing plain interrupted 'running' rows.
 */
describe("markInterruptedRuns re-arm", () => {
  const db = getDb();
  const projectId = crypto.randomUUID();
  const taskId = crypto.randomUUID();

  // A claimed-but-crashed resume: running + resume metadata, under the cap.
  const resumeRunId = crypto.randomUUID();
  // A plain interrupted run with no resume metadata.
  const plainRunId = crypto.randomUUID();
  // A resume that already hit the attempt cap — should NOT be re-armed.
  const cappedRunId = crypto.randomUUID();

  beforeAll(() => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      projectId,
      "rearm-test",
      `/tmp/vk-rearm-${projectId}`,
    );
    db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
      taskId,
      projectId,
      "rearm task",
    );
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt, resumeReason, worktreeDir, worktreeBranch, runMode, resumeAttempts)
       VALUES (?, ?, ?, 'headless', 'running', ?, 'usage-limit', '/tmp/wt/x', 'vk/abc-def', 'worktree', 1)`,
    ).run(resumeRunId, taskId, projectId, ts);
    db.prepare(
      `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt)
       VALUES (?, ?, ?, 'headless', 'running', ?)`,
    ).run(plainRunId, taskId, projectId, ts);
    db.prepare(
      `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt, resumeReason, worktreeDir, worktreeBranch, runMode, resumeAttempts)
       VALUES (?, ?, ?, 'headless', 'running', ?, 'usage-limit', '/tmp/wt/y', 'vk/ghi-jkl', 'worktree', ?)`,
    ).run(cappedRunId, taskId, projectId, ts, getResumeMaxAttempts());
  });

  afterAll(() => {
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  });

  test("re-arms an interrupted resume, fails a plain run, caps the over-limit one", () => {
    markInterruptedRuns();

    const resumed = db
      .prepare("SELECT status, resumeAt, finishedAt FROM task_ai_runs WHERE id = ?")
      .get(resumeRunId) as { status: string; resumeAt: string | null; finishedAt: string | null };
    expect(resumed.status).toBe("waiting_limit");
    expect(resumed.resumeAt).toBeTruthy();

    const plain = db
      .prepare("SELECT status, finishedAt FROM task_ai_runs WHERE id = ?")
      .get(plainRunId) as { status: string; finishedAt: string | null };
    expect(plain.status).toBe("failed");
    expect(plain.finishedAt).toBeTruthy();

    const capped = db.prepare("SELECT status FROM task_ai_runs WHERE id = ?").get(cappedRunId) as {
      status: string;
    };
    expect(capped.status).toBe("failed"); // at cap → not re-armed
  });
});
