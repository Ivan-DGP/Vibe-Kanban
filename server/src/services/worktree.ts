/**
 * Per-run git worktree isolation for headless task runs.
 *
 * Instead of letting an autonomous agent edit the project's working tree
 * directly, each run executes in a throwaway worktree on a dedicated `vk/…`
 * branch:
 *   - SUCCESS  -> any uncommitted changes are committed to the branch, the
 *                worktree dir is removed, and the branch is recorded on the task
 *                (reviewable; the user's main working tree is never touched).
 *   - FAILURE  -> the worktree AND branch are deleted (full rollback).
 *
 * Enabled by default for git repos; set VK_TASK_WORKTREES=0 to run in place.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnProcess } from "../lib/runtime";
import { getDataDir } from "../lib/data-dir";
import { assertSafeSegment } from "../lib/path-safety";
import { getDb } from "../db";
import { log } from "../lib/logger";

export interface RunWorktree {
  branch: string;
  dir: string;
}

export function worktreesEnabled(): boolean {
  return process.env.VK_TASK_WORKTREES !== "0";
}

export function isGitRepo(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, ".git"));
  } catch {
    return false;
  }
}

function git(cwd: string, args: string[]) {
  return spawnProcess(["git", ...args], { cwd, timeout: 60_000 });
}

// Serialize git worktree add/remove/commit per project. The runs themselves run
// in parallel (distinct worktree dirs); only the git plumbing is serialized so
// concurrent `worktree add`/`remove` can't race.
const gitTail = new Map<string, Promise<void>>();
async function withGitLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = gitTail.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  gitTail.set(
    projectId,
    prev.then(() => next),
  );
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
}

function worktreeDirFor(projectId: string, runId: string): string {
  return path.join(getDataDir(), "worktrees", assertSafeSegment(projectId, "projectId"), runId);
}

/**
 * Create an isolated worktree for a run. Returns null (caller runs in place) when
 * worktrees are disabled, the project isn't a git repo, or git fails.
 */
export async function createRunWorktree(input: {
  projectPath: string;
  projectId: string;
  taskId: string;
  runId: string;
}): Promise<RunWorktree | null> {
  if (!worktreesEnabled()) return null;
  if (!isGitRepo(input.projectPath)) return null;

  const branch = `vk/${input.taskId.slice(0, 8)}-${input.runId.slice(0, 8)}`;
  let dir: string;
  try {
    dir = worktreeDirFor(input.projectId, input.runId);
  } catch {
    return null; // unsafe projectId — fall back to in-place
  }

  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    return await withGitLock(input.projectId, async () => {
      await git(input.projectPath, ["worktree", "prune"]); // clear stale registrations
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      const res = await git(input.projectPath, ["worktree", "add", "-b", branch, dir, "HEAD"]);
      if (res.exitCode !== 0) {
        log("warn", "claude", "worktree add failed; running in place", {
          projectId: input.projectId,
          stderr: res.stderr.slice(-300),
        });
        await git(input.projectPath, ["branch", "-D", branch]).catch(() => undefined);
        return null;
      }
      log("info", "claude", "created run worktree", { branch, dir });
      return { branch, dir };
    });
  } catch (e) {
    log("error", "claude", "createRunWorktree error", { error: String(e) });
    return null;
  }
}

/** Commit any leftover changes to the branch, remove the worktree, record branch on the task. */
export async function finalizeWorktreeSuccess(input: {
  projectPath: string;
  projectId: string;
  dir: string;
  branch: string;
  taskId: string;
  runId: string;
}): Promise<void> {
  await withGitLock(input.projectId, async () => {
    await git(input.dir, ["add", "-A"]).catch(() => undefined);
    // Commit any uncommitted remainder (the agent may already have committed —
    // a "nothing to commit" non-zero exit is fine).
    await git(input.dir, [
      "-c",
      "user.name=vibe-kanban",
      "-c",
      "user.email=vibe-kanban@local",
      "commit",
      "-m",
      `vk: automated task run ${input.runId.slice(0, 8)}`,
      "--no-verify",
    ]).catch(() => undefined);

    const rm = await git(input.projectPath, ["worktree", "remove", "--force", input.dir]);
    if (rm.exitCode !== 0) {
      log("warn", "claude", "worktree remove failed (finalize)", {
        dir: input.dir,
        stderr: rm.stderr.slice(-300),
      });
    }
    try {
      getDb()
        .prepare("UPDATE tasks SET branch = ?, updatedAt = ? WHERE id = ?")
        .run(input.branch, new Date().toISOString(), input.taskId);
    } catch (e) {
      log("error", "claude", "failed to record task.branch", { error: String(e) });
    }
    log("info", "claude", "run worktree finalized to branch", { branch: input.branch });
  });
}

/** Discard a run's worktree AND its branch (full rollback on failure/cancel). */
export async function discardWorktree(input: {
  projectPath: string;
  projectId: string;
  dir: string;
  branch: string;
}): Promise<void> {
  await withGitLock(input.projectId, async () => {
    const rm = await git(input.projectPath, ["worktree", "remove", "--force", input.dir]);
    if (rm.exitCode !== 0) {
      await git(input.projectPath, ["worktree", "prune"]).catch(() => undefined);
      if (fs.existsSync(input.dir)) fs.rmSync(input.dir, { recursive: true, force: true });
    }
    await git(input.projectPath, ["branch", "-D", input.branch]).catch(() => undefined);
    log("info", "claude", "run worktree discarded", { branch: input.branch });
  });
}
