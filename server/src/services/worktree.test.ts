import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { createRunWorktree, finalizeWorktreeSuccess, discardWorktree, isGitRepo } from "./worktree";
import { getDb } from "../db";
import { getDataDir } from "../lib/data-dir";

let repo: string;
const projectId = crypto.randomUUID();
const taskId = crypto.randomUUID();

function branches(): string {
  // execFileSync (no shell) so the %(refname:short) format isn't mangled by sh.
  return execFileSync("git", ["branch", "--format=%(refname:short)"], { cwd: repo }).toString();
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "vk-wt-test-"));
  execSync("git init -q", { cwd: repo });
  execSync("git config user.email t@t.local", { cwd: repo });
  execSync("git config user.name tester", { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  execSync("git add -A", { cwd: repo });
  execSync("git commit -q -m init", { cwd: repo });

  const db = getDb();
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    projectId,
    "wt-test",
    repo,
  );
  db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
    taskId,
    projectId,
    "wt task",
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

describe("worktree isolation", () => {
  test("isGitRepo detects a git repo", () => {
    expect(isGitRepo(repo)).toBe(true);
    expect(isGitRepo(os.tmpdir())).toBe(false);
  });

  test("createRunWorktree makes a worktree on a vk/ branch", async () => {
    const runId = crypto.randomUUID();
    const wt = await createRunWorktree({ projectPath: repo, projectId, taskId, runId });
    expect(wt).not.toBeNull();
    expect(wt!.branch.startsWith("vk/")).toBe(true);
    expect(fs.existsSync(wt!.dir)).toBe(true);
    expect(branches()).toContain(wt!.branch);
    await discardWorktree({ projectPath: repo, projectId, dir: wt!.dir, branch: wt!.branch });
  });

  test("finalize commits changes to the branch, removes worktree, records task.branch", async () => {
    const runId = crypto.randomUUID();
    const wt = (await createRunWorktree({ projectPath: repo, projectId, taskId, runId }))!;
    fs.writeFileSync(path.join(wt.dir, "agent-output.txt"), "changed by agent\n");

    await finalizeWorktreeSuccess({
      projectPath: repo,
      projectId,
      dir: wt.dir,
      branch: wt.branch,
      taskId,
      runId,
    });

    expect(fs.existsSync(wt.dir)).toBe(false); // worktree removed
    const tipFiles = execSync(`git show --name-only --format= ${wt.branch}`, {
      cwd: repo,
    }).toString();
    expect(tipFiles).toContain("agent-output.txt"); // change committed to branch
    const task = getDb().prepare("SELECT branch FROM tasks WHERE id = ?").get(taskId) as {
      branch: string | null;
    };
    expect(task.branch).toBe(wt.branch);
    // main working tree untouched
    expect(fs.existsSync(path.join(repo, "agent-output.txt"))).toBe(false);
  });

  test("discard removes the worktree and deletes the branch (rollback)", async () => {
    const runId = crypto.randomUUID();
    const wt = (await createRunWorktree({ projectPath: repo, projectId, taskId, runId }))!;
    fs.writeFileSync(path.join(wt.dir, "junk.txt"), "discard me\n");

    await discardWorktree({ projectPath: repo, projectId, dir: wt.dir, branch: wt.branch });

    expect(fs.existsSync(wt.dir)).toBe(false);
    expect(branches()).not.toContain(wt.branch);
  });

  test("returns null for a non-git project (in-place fallback)", async () => {
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), "vk-nongit-"));
    const wt = await createRunWorktree({
      projectPath: nonGit,
      projectId,
      taskId,
      runId: crypto.randomUUID(),
    });
    expect(wt).toBeNull();
    fs.rmSync(nonGit, { recursive: true, force: true });
  });

  test("VK_TASK_WORKTREES=0 disables isolation", async () => {
    const prev = process.env.VK_TASK_WORKTREES;
    process.env.VK_TASK_WORKTREES = "0";
    try {
      const wt = await createRunWorktree({
        projectPath: repo,
        projectId,
        taskId,
        runId: crypto.randomUUID(),
      });
      expect(wt).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.VK_TASK_WORKTREES;
      else process.env.VK_TASK_WORKTREES = prev;
    }
  });
});
