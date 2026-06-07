import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getDb } from "../db";
import {
  markInterruptedRuns,
  hasRunningRun,
  cancelHeadlessRun,
  listActiveRuns,
} from "./headlessClaude";

describe("headless run lifecycle", () => {
  const db = getDb();
  const projectId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const runningRunId = crypto.randomUUID();

  beforeAll(() => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      projectId,
      "lifecycle-test",
      `/tmp/vk-lifecycle-${projectId}`,
    );
    db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
      taskId,
      projectId,
      "lifecycle task",
    );
    db.prepare(
      `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt)
       VALUES (?, ?, ?, 'headless', 'running', ?)`,
    ).run(runningRunId, taskId, projectId, new Date().toISOString());
  });

  afterAll(() => {
    // ON DELETE CASCADE removes the task + its task_ai_runs.
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  });

  test("hasRunningRun is true while a run is 'running'", () => {
    expect(hasRunningRun(taskId)).toBe(true);
  });

  test("cancelHeadlessRun returns false for a non-active id", () => {
    expect(cancelHeadlessRun("does-not-exist")).toBe(false);
  });

  test("listActiveRuns is in-memory only (excludes DB-only running rows)", () => {
    // The DB row above has no live process, so it must not appear as active.
    expect(listActiveRuns().some((r) => r.runId === runningRunId)).toBe(false);
  });

  test("markInterruptedRuns flips orphaned 'running' rows to 'failed'", () => {
    markInterruptedRuns();
    const row = db
      .prepare("SELECT status, finishedAt FROM task_ai_runs WHERE id = ?")
      .get(runningRunId) as { status: string; finishedAt: string | null };
    expect(row.status).toBe("failed");
    expect(row.finishedAt).toBeTruthy();
    expect(hasRunningRun(taskId)).toBe(false);
  });
});
