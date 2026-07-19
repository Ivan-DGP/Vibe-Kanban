import { describe, test, expect, beforeAll, afterEach, afterAll, mock } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Load the real module first so it's fully cached before the mock replaces it —
// otherwise `...real` in the factory misses named exports (e.g. hasRunningRun).
import "../services/headlessClaude";

// Stub the headless runner so the dispatch endpoint never launches a real CLI.
const spawnCalls: { taskId: string; runId?: string }[] = [];
mock.module("../services/headlessClaude", () => {
  const real = require("../services/headlessClaude");
  return {
    ...real,
    spawnHeadlessClaude: async (opts: { taskId: string; runId?: string }) => {
      spawnCalls.push(opts);
      return { exitCode: 0, summary: null, sessionId: "s", durationMs: 1, runId: opts.runId };
    },
  };
});

const { buildApp } = await import("../app");
import { getDb } from "../db";

let app: Awaited<ReturnType<typeof buildApp>>;
let db: ReturnType<typeof getDb>;
let projectDir: string;
const PROJECT_ID = `__sup_disp_route_${crypto.randomUUID()}__`;

function seedTask(origin?: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata = origin ? JSON.stringify({ origin, signalKey: "roadmap:x" }) : "{}";
  db.prepare(
    `INSERT INTO tasks (id, projectId, title, description, status, priority, taskNumber, sortOrder, inboxAt, metadata, createdAt, updatedAt)
     VALUES (?, ?, 'Do the thing', 'why', 'backlog', 'medium', 1, 1, ?, ?, ?, ?)`,
  ).run(id, PROJECT_ID, now, metadata, now, now);
  return id;
}

const dispatch = (taskId: string) =>
  app.inject({ method: "POST", url: `/api/supervisor/proposals/${taskId}/dispatch` });

beforeAll(async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sup-disp-route-"));
  app = await buildApp();
  await app.ready();
  db = getDb();
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    PROJECT_ID,
    "Dispatch Route Test",
    projectDir,
  );
});

afterEach(() => {
  delete process.env.VK_SUPERVISOR_DISPATCH_ENABLED;
  spawnCalls.length = 0;
  db.prepare("DELETE FROM tasks WHERE projectId = ?").run(PROJECT_ID);
});

afterAll(async () => {
  db.prepare("DELETE FROM tasks WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM projects WHERE id = ?").run(PROJECT_ID);
  fs.rmSync(projectDir, { recursive: true, force: true });
  await app.close();
});

describe("POST /api/supervisor/proposals/:taskId/dispatch", () => {
  test("403 and NO spawn when the master switch is off (default)", async () => {
    const id = seedTask("supervisor");
    const res = await dispatch(id);
    expect(res.statusCode).toBe(403);
    expect(spawnCalls.length).toBe(0);
  });

  test("200 + runId when enabled; spawns; idempotent on a second call", async () => {
    process.env.VK_SUPERVISOR_DISPATCH_ENABLED = "true";
    const id = seedTask("supervisor");

    const first = await dispatch(id);
    expect(first.statusCode).toBe(200);
    const runId = (first.json() as { runId: string }).runId;
    expect(runId).toBeTruthy();
    expect(spawnCalls.length).toBe(1);
    // Task moved to in_progress.
    const status = (
      db.prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string }
    ).status;
    expect(status).toBe("in_progress");

    const second = await dispatch(id);
    expect(second.statusCode).toBe(200);
    expect(second.json() as { runId: string; alreadyDispatched: boolean }).toEqual({
      runId,
      alreadyDispatched: true,
    });
    expect(spawnCalls.length).toBe(1); // no second spawn
  });

  test("400 for a non-supervisor task", async () => {
    process.env.VK_SUPERVISOR_DISPATCH_ENABLED = "true";
    const id = seedTask(undefined); // metadata '{}'
    const res = await dispatch(id);
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("not_supervisor");
    expect(spawnCalls.length).toBe(0);
  });

  test("404 for a missing task", async () => {
    process.env.VK_SUPERVISOR_DISPATCH_ENABLED = "true";
    const res = await dispatch("nope");
    expect(res.statusCode).toBe(404);
    expect(spawnCalls.length).toBe(0);
  });
});
