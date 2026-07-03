import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";
import { getDb } from "../db";

let app: Awaited<ReturnType<typeof buildApp>>;
const projectId = crypto.randomUUID();
const taskId = crypto.randomUUID();
const parkedRunId = crypto.randomUUID();
const doneRunId = crypto.randomUUID();

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const db = getDb();
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    projectId,
    "resume-route",
    `/tmp/vk-resume-route-${projectId}`,
  );
  db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
    taskId,
    projectId,
    "t",
  );
  // Parked, with resumeAt far in the future so the boot/interval sweep ignores it
  // until the route makes it due.
  const future = new Date(Date.now() + 6 * 3600_000).toISOString();
  db.prepare(
    `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt, sessionId, resumeReason, resumeAt, resumeAttempts, runMode)
     VALUES (?, ?, ?, 'headless', 'waiting_limit', ?, 'sess-x', 'usage-limit', ?, 1, 'in_place')`,
  ).run(parkedRunId, taskId, projectId, future, future);
  db.prepare(
    `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt, exitCode, success)
     VALUES (?, ?, ?, 'headless', 'succeeded', ?, 0, 1)`,
  ).run(doneRunId, taskId, projectId, new Date().toISOString());
});

afterAll(async () => {
  try {
    await app.close(); // stops the resume scheduler interval
  } catch {}
  try {
    getDb().prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  } catch {}
});

describe("POST /api/claude/runs/:runId/resume", () => {
  test("makes a parked run due immediately", async () => {
    const before = getDb()
      .prepare("SELECT resumeAt FROM task_ai_runs WHERE id = ?")
      .get(parkedRunId) as { resumeAt: string };
    const beforeMs = new Date(before.resumeAt).getTime();

    const res = await app.inject({
      method: "POST",
      url: `/api/claude/runs/${parkedRunId}/resume`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const after = getDb()
      .prepare("SELECT resumeAt FROM task_ai_runs WHERE id = ?")
      .get(parkedRunId) as { resumeAt: string };
    // resumeAt was pulled forward from the future to (about) now.
    expect(new Date(after.resumeAt).getTime()).toBeLessThan(beforeMs);
    expect(new Date(after.resumeAt).getTime()).toBeLessThanOrEqual(Date.now() + 2000);
  });

  test("404 for a non-parked (terminal) run", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/claude/runs/${doneRunId}/resume`,
    });
    expect(res.statusCode).toBe(404);
  });

  test("404 for an unknown run id", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/claude/runs/does-not-exist/resume`,
    });
    expect(res.statusCode).toBe(404);
  });

  test("GET /api/claude/runs surfaces the resume columns (RUN_COLUMNS)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/claude/runs?taskId=${taskId}` });
    expect(res.statusCode).toBe(200);
    const runs = res.json().runs as Array<Record<string, unknown>>;
    const run = runs.find((r) => r.id === parkedRunId)!;
    expect(run).toBeTruthy();
    // The resume columns must be projected by RUN_COLUMNS (values persist even if a
    // background sweep has since transitioned the row's status).
    expect("resumeAt" in run).toBe(true);
    expect(run.resumeReason).toBe("usage-limit");
    expect(run.resumeAttempts).toBe(1);
  });
});
