import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { createRunWorktree, checkpointWorktree, reviveWorktree, discardWorktree } from "./worktree";
import { getDb } from "../db";
import { getDataDir } from "../lib/data-dir";

let repo: string;
const projectId = crypto.randomUUID();
const taskId = crypto.randomUUID();

function branches(): string {
  return execFileSync("git", ["branch", "--format=%(refname:short)"], { cwd: repo }).toString();
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "vk-wt-resume-"));
  execSync("git init -q", { cwd: repo });
  execSync("git config user.email t@t.local", { cwd: repo });
  execSync("git config user.name tester", { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  execSync("git add -A", { cwd: repo });
  execSync("git commit -q -m init", { cwd: repo });

  const db = getDb();
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    projectId,
    "wt-resume",
    repo,
  );
  db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
    taskId,
    projectId,
    "wt resume task",
  );
});

afterAll(() => {
  try {
    getDb().prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  } catch {}
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch {}
  try {
    fs.rmSync(path.join(getDataDir(), "worktrees", projectId), { recursive: true, force: true });
  } catch {}
});

describe("checkpointWorktree", () => {
  test("commits WIP to the run's branch without removing the worktree", async () => {
    const runId = crypto.randomUUID();
    const wt = (await createRunWorktree({ projectPath: repo, projectId, taskId, runId }))!;
    fs.writeFileSync(path.join(wt.dir, "wip.txt"), "in progress\n");

    await checkpointWorktree({ projectId, dir: wt.dir, runId });

    // Worktree dir + branch survive (run will resume here).
    expect(fs.existsSync(wt.dir)).toBe(true);
    expect(branches()).toContain(wt.branch);
    // WIP committed to the branch.
    const tipFiles = execSync(`git show --name-only --format= ${wt.branch}`, {
      cwd: repo,
    }).toString();
    expect(tipFiles).toContain("wip.txt");
    // Idempotent: a second checkpoint with nothing new is a no-op (no throw).
    await checkpointWorktree({ projectId, dir: wt.dir, runId });

    await discardWorktree({ projectPath: repo, projectId, dir: wt.dir, branch: wt.branch });
  });
});

describe("reviveWorktree", () => {
  test("returns the existing ref when the dir is still registered", async () => {
    const runId = crypto.randomUUID();
    const wt = (await createRunWorktree({ projectPath: repo, projectId, taskId, runId }))!;
    const revived = await reviveWorktree({
      projectPath: repo,
      projectId,
      dir: wt.dir,
      branch: wt.branch,
    });
    expect(revived).not.toBeNull();
    expect(revived!.dir).toBe(wt.dir);
    expect(fs.existsSync(wt.dir)).toBe(true);
    await discardWorktree({ projectPath: repo, projectId, dir: wt.dir, branch: wt.branch });
  });

  test("reattaches from the branch when the dir was deleted (WIP recovered)", async () => {
    const runId = crypto.randomUUID();
    const wt = (await createRunWorktree({ projectPath: repo, projectId, taskId, runId }))!;
    fs.writeFileSync(path.join(wt.dir, "recover-me.txt"), "agent work\n");
    await checkpointWorktree({ projectId, dir: wt.dir, runId });

    // Simulate the dir vanishing (e.g. a hard crash) while the branch survives.
    execSync(`git worktree remove --force ${wt.dir}`, { cwd: repo });
    expect(fs.existsSync(wt.dir)).toBe(false);
    expect(branches()).toContain(wt.branch); // branch (with WIP) still there

    const revived = await reviveWorktree({
      projectPath: repo,
      projectId,
      dir: wt.dir,
      branch: wt.branch,
    });
    expect(revived).not.toBeNull();
    expect(fs.existsSync(wt.dir)).toBe(true);
    // The checkpointed WIP is present in the revived tree.
    expect(fs.existsSync(path.join(wt.dir, "recover-me.txt"))).toBe(true);

    await discardWorktree({ projectPath: repo, projectId, dir: wt.dir, branch: wt.branch });
  });

  test("returns null when both dir and branch are gone (caller degrades to fresh)", async () => {
    const runId = crypto.randomUUID();
    const wt = (await createRunWorktree({ projectPath: repo, projectId, taskId, runId }))!;
    await discardWorktree({ projectPath: repo, projectId, dir: wt.dir, branch: wt.branch }); // removes dir + branch
    expect(branches()).not.toContain(wt.branch);

    const revived = await reviveWorktree({
      projectPath: repo,
      projectId,
      dir: wt.dir,
      branch: wt.branch,
    });
    expect(revived).toBeNull();
  });
});
