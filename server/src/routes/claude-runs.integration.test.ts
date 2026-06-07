import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";
import { getDb } from "../db";

let app: Awaited<ReturnType<typeof buildApp>>;
const projectId = crypto.randomUUID();
const taskId = crypto.randomUUID();
const otherTaskId = crypto.randomUUID();
const runA = crypto.randomUUID();
const runB = crypto.randomUUID();

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const db = getDb();
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    projectId,
    "runs-test",
    `/tmp/vk-runs-${projectId}`,
  );
  db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
    taskId,
    projectId,
    "t1",
  );
  db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
    otherTaskId,
    projectId,
    "t2",
  );
  db.prepare(
    `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, exitCode, success, durationMs, totalCostUsd, startedAt, finishedAt)
     VALUES (?, ?, ?, 'headless', 'succeeded', 0, 1, 1234, 0.0123, ?, ?)`,
  ).run(runA, taskId, projectId, new Date().toISOString(), new Date().toISOString());
  db.prepare(
    `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, exitCode, success, durationMs, totalCostUsd, startedAt, finishedAt)
     VALUES (?, ?, ?, 'headless', 'failed', 1, 0, 99, NULL, ?, ?)`,
  ).run(runB, otherTaskId, projectId, new Date().toISOString(), new Date().toISOString());
});

afterAll(async () => {
  try {
    getDb().prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  } catch {}
});

describe("GET /api/claude/runs", () => {
  test("lists runs for a project with status/cost fields", async () => {
    const res = await app.inject({ method: "GET", url: `/api/claude/runs?projectId=${projectId}` });
    expect(res.statusCode).toBe(200);
    const runs = res.json().runs as any[];
    const ids = runs.map((r) => r.id);
    expect(ids).toContain(runA);
    expect(ids).toContain(runB);
    const a = runs.find((r) => r.id === runA);
    expect(a.status).toBe("succeeded");
    expect(a.totalCostUsd).toBe(0.0123);
    expect(a.durationMs).toBe(1234);
  });

  test("filters by taskId", async () => {
    const res = await app.inject({ method: "GET", url: `/api/claude/runs?taskId=${taskId}` });
    const runs = res.json().runs as any[];
    expect(runs.every((r) => r.taskId === taskId)).toBe(true);
    expect(runs.some((r) => r.id === runA)).toBe(true);
    expect(runs.some((r) => r.id === runB)).toBe(false);
  });

  test("GET /api/claude/runs/:runId returns one run; 404 for unknown", async () => {
    const ok = await app.inject({ method: "GET", url: `/api/claude/runs/${runA}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().id).toBe(runA);

    const missing = await app.inject({ method: "GET", url: `/api/claude/runs/does-not-exist` });
    expect(missing.statusCode).toBe(404);
  });

  test("GET /api/claude/runs/active is not shadowed by the :runId route", async () => {
    const res = await app.inject({ method: "GET", url: `/api/claude/runs/active` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stats).toBeDefined();
    expect(Array.isArray(body.runs)).toBe(true);
  });
});
