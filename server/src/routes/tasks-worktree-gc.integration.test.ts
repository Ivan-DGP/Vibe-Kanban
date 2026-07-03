/**
 * Deleting a task must GC any worktree its runs left on disk (a parked or
 * hard-crashed run persists its tree under data/worktrees/<projectId>/<runId>).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { buildApp } from "../app";
import { getDb } from "../db";

let app: Awaited<ReturnType<typeof buildApp>>;
let repo: string;
let worktreeDir: string;
const projectId = crypto.randomUUID();
const taskId = crypto.randomUUID();
const runId = crypto.randomUUID();

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  repo = fs.mkdtempSync(path.join(os.tmpdir(), "vk-gc-repo-"));
  execSync("git init -q", { cwd: repo });
  execSync("git config user.email t@t.local", { cwd: repo });
  execSync("git config user.name tester", { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "x\n");
  execSync("git add -A && git commit -q -m init", { cwd: repo });

  const db = getDb();
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(projectId, "gc", repo);
  db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
    taskId,
    projectId,
    "gc task",
  );

  // A leftover worktree dir on disk + a run row pointing at it.
  worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-gc-wt-"));
  fs.writeFileSync(path.join(worktreeDir, "wip.txt"), "leftover\n");
  db.prepare(
    `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt, worktreeDir, worktreeBranch, runMode)
     VALUES (?, ?, ?, 'headless', 'waiting_limit', ?, ?, 'vk/gc-1', 'worktree')`,
  ).run(runId, taskId, projectId, new Date().toISOString(), worktreeDir);
});

afterAll(async () => {
  try {
    await app.close();
  } catch {}
  try {
    getDb().prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  } catch {}
  for (const d of [repo, worktreeDir]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {}
  }
});

describe("DELETE /api/tasks/:id worktree GC", () => {
  test("removes the run's leftover worktree dir on disk", async () => {
    expect(fs.existsSync(worktreeDir)).toBe(true);

    const res = await app.inject({ method: "DELETE", url: `/api/tasks/${taskId}` });
    expect(res.statusCode).toBe(204);

    // discardWorktree runs best-effort/async after the response; give it a moment.
    await wait(300);
    expect(fs.existsSync(worktreeDir)).toBe(false);
  });
});
