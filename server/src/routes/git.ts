import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { spawn } from "../lib/spawn";
import { log } from "../lib/logger";
import { getMappedGitHubAccount, gitAuthEnv, gitCommitIdentityArgs } from "../lib/git-auth";
import { resolveWithin } from "../lib/path-safety";
import path from "node:path";
import fs from "node:fs";

export function resolveGitCwd(projectPath: string, subPath?: string): string {
  if (!subPath) return projectPath;
  try {
    return resolveWithin(projectPath, subPath);
  } catch {
    throw new Error("Invalid subPath");
  }
}

/** Conservative git ref validation: no leading '-' (option injection), no
 *  shell metacharacters, no '..', no whitespace/control. */
function isValidRef(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name.startsWith("-")) return false;
  if (name.includes("..")) return false;
  if (name.endsWith("/") || name.endsWith(".lock")) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\s~^:?*[\\;&|`$()<>'"]/.test(name) && !/[\x00-\x1f\x7f]/.test(name);
}

/** Keep only string entries; positional args are always passed after `--`. */
function toFileArgs(files: unknown): string[] {
  if (!Array.isArray(files)) return [];
  return files.filter((f): f is string => typeof f === "string" && f.length > 0);
}

function getProjectPath(projectId: string): string {
  const db = getDb();
  const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) {
    const err = new Error("Project not found") as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  if (!project.path || !fs.existsSync(project.path)) {
    const err = new Error("Project path does not exist on disk") as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  return project.path;
}

function isGitRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}

const EMPTY_STATUS = {
  branch: "",
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  untracked: [],
};

export function parseStatus(stdout: string) {
  const lines = stdout.split("\n").filter(Boolean);
  const result = {
    branch: "",
    upstream: null as string | null,
    ahead: 0,
    behind: 0,
    staged: [] as { path: string; status: string; oldPath?: string }[],
    unstaged: [] as { path: string; status: string }[],
    untracked: [] as string[],
  };

  for (const line of lines) {
    if (line.startsWith("# branch.head ")) {
      result.branch = line.slice(14);
    } else if (line.startsWith("# branch.upstream ")) {
      result.upstream = line.slice(18);
    } else if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+) -(\d+)/);
      if (match) {
        result.ahead = parseInt(match[1]);
        result.behind = parseInt(match[2]);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const parts = line.split(" ");
      const xy = parts[1];
      const filePath = line.startsWith("2 ")
        ? line.split("\t")[1] || parts[parts.length - 1]
        : parts[parts.length - 1];

      if (xy[0] !== ".") {
        result.staged.push({ path: filePath, status: xy[0] });
      }
      if (xy[1] !== ".") {
        result.unstaged.push({ path: filePath, status: xy[1] });
      }
    } else if (line.startsWith("? ")) {
      result.untracked.push(line.slice(2));
    }
  }

  return result;
}

const gitRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/projects/:projectId/git/status", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.query as any;
    const projectPath = getProjectPath(projectId);
    const cwd = resolveGitCwd(projectPath, subPath);
    if (!isGitRepo(cwd) && !isGitRepo(projectPath)) return EMPTY_STATUS;
    const result = await spawn(["git", "status", "--porcelain=v2", "--branch"], { cwd });
    if (result.exitCode !== 0) return EMPTY_STATUS;
    return parseStatus(result.stdout);
  });

  fastify.get("/projects/:projectId/git/log", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.query as any;
    const projectPath = getProjectPath(projectId);
    const cwd = resolveGitCwd(projectPath, subPath);
    if (!isGitRepo(cwd) && !isGitRepo(projectPath)) return [];
    const result = await spawn(["git", "log", "--oneline", "-30", "--format=%H|%h|%an|%aI|%s"], {
      cwd,
    });
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, hashShort, author, date, ...msgParts] = line.split("|");
        return { hash, hashShort, author, date, message: msgParts.join("|") };
      });
  });

  fastify.get("/projects/:projectId/git/branches", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.query as any;
    const projectPath = getProjectPath(projectId);
    const cwd = resolveGitCwd(projectPath, subPath);
    if (!isGitRepo(cwd) && !isGitRepo(projectPath)) return [];
    const result = await spawn(["git", "branch", "-a", "--format=%(refname:short)|%(HEAD)"], {
      cwd,
    });
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, head] = line.split("|");
        return { name, current: head === "*", remote: name.startsWith("remotes/") };
      });
  });

  fastify.post("/projects/:projectId/git/stage", async (request) => {
    const { projectId } = request.params as any;
    const { files, subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const fileArgs = toFileArgs(files);
    const args = fileArgs.length ? ["git", "add", "--", ...fileArgs] : ["git", "add", "-A"];
    const result = await spawn(args, { cwd });
    log("info", "git", "Staged files", { projectId, files: fileArgs });
    return { ok: result.exitCode === 0, stderr: result.stderr };
  });

  fastify.post("/projects/:projectId/git/unstage", async (request) => {
    const { projectId } = request.params as any;
    const { files, subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const fileArgs = toFileArgs(files);
    const args = fileArgs.length
      ? ["git", "reset", "HEAD", "--", ...fileArgs]
      : ["git", "reset", "HEAD"];
    const result = await spawn(args, { cwd });
    return { ok: result.exitCode === 0, stderr: result.stderr };
  });

  fastify.post("/projects/:projectId/git/commit", async (request) => {
    const { projectId } = request.params as any;
    const { message, subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const account = getMappedGitHubAccount(projectId, subPath ?? "");
    const identityArgs = account ? gitCommitIdentityArgs(account) : [];
    const result = await spawn(["git", ...identityArgs, "commit", "-m", message], { cwd });
    log("info", "git", `Commit: ${message}`, { projectId, account: account?.name });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  });

  fastify.post("/projects/:projectId/git/push", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const account = getMappedGitHubAccount(projectId, subPath ?? "");
    const authEnv = account ? gitAuthEnv(account.token) : undefined;
    // Check if current branch has an upstream; if not, push with --set-upstream
    const upstream = await spawn(
      ["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { cwd },
    );
    const pushArgs =
      upstream.exitCode !== 0 ? ["push", "--set-upstream", "origin", "HEAD"] : ["push"];
    const result = await spawn(["git", ...pushArgs], { cwd, timeout: 30000, env: authEnv });
    log("info", "git", "Push", { projectId, account: account?.name });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  });

  fastify.post("/projects/:projectId/git/pull", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const account = getMappedGitHubAccount(projectId, subPath ?? "");
    const authEnv = account ? gitAuthEnv(account.token) : undefined;
    const result = await spawn(["git", "pull"], { cwd, timeout: 30000, env: authEnv });
    log("info", "git", "Pull", { projectId, account: account?.name });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  });

  fastify.post("/projects/:projectId/git/discard", async (request) => {
    const { projectId } = request.params as any;
    const { files, subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const fileArgs = toFileArgs(files);
    if (fileArgs.length) {
      await spawn(["git", "checkout", "--", ...fileArgs], { cwd });
    } else {
      await spawn(["git", "checkout", "--", "."], { cwd });
    }
    log("warn", "git", "Discarded changes", { projectId, files: fileArgs });
    return { ok: true };
  });

  fastify.post("/projects/:projectId/git/undo-commit", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const result = await spawn(["git", "reset", "--soft", "HEAD~1"], { cwd });
    log("warn", "git", "Undo commit", { projectId });
    return { ok: result.exitCode === 0, stderr: result.stderr };
  });

  fastify.get("/projects/:projectId/git/diff", async (request) => {
    const { projectId } = request.params as any;
    const { file, subPath, staged } = request.query as any;
    const projectPath = getProjectPath(projectId);
    const cwd = resolveGitCwd(projectPath, subPath);
    if (!isGitRepo(cwd) && !isGitRepo(projectPath)) return "";
    const args = ["git", "diff"];
    if (staged === "true") args.push("--cached");
    // `--` ensures a user-supplied value (e.g. `--output=/etc/x`) is treated as a
    // pathspec, not a git option — closes the arbitrary-file-write via `git diff`.
    if (file && typeof file === "string") args.push("--", file);
    const result = await spawn(args, { cwd });
    return result.stdout;
  });

  // Main branch divergence
  fastify.get("/projects/:projectId/git/divergence", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.query as any;
    const projectPath = getProjectPath(projectId);
    const cwd = resolveGitCwd(projectPath, subPath);
    if (!isGitRepo(cwd) && !isGitRepo(projectPath))
      return { mainBranch: null, ahead: 0, behind: 0 };
    // Try main, then master
    for (const main of ["main", "master"]) {
      const check = await spawn(["git", "rev-parse", "--verify", main], { cwd });
      if (check.exitCode === 0) {
        const result = await spawn(
          ["git", "rev-list", "--left-right", "--count", `${main}...HEAD`],
          { cwd },
        );
        if (result.exitCode === 0) {
          const [behind, ahead] = result.stdout.split("\t").map(Number);
          return { mainBranch: main, ahead: ahead || 0, behind: behind || 0 };
        }
      }
    }
    return { mainBranch: null, ahead: 0, behind: 0 };
  });

  // Create branch
  fastify.post("/projects/:projectId/git/create-branch", async (request) => {
    const { projectId } = request.params as any;
    const { branch, baseBranch, subPath } = request.body as any;
    if (!isValidRef(branch)) {
      return { ok: false, error: "Invalid branch name" };
    }
    if (
      baseBranch !== undefined &&
      baseBranch !== null &&
      baseBranch !== "" &&
      !isValidRef(baseBranch)
    ) {
      return { ok: false, error: "Invalid base branch name" };
    }
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    if (baseBranch) {
      await spawn(["git", "checkout", baseBranch], { cwd });
    }
    const result = await spawn(["git", "checkout", "-b", branch], { cwd });
    log("info", "git", `Create branch: ${branch}`, { projectId });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  });

  // Checkout branch
  fastify.post("/projects/:projectId/git/checkout", async (request) => {
    const { projectId } = request.params as any;
    const { branch, subPath } = request.body as any;
    if (!isValidRef(branch)) {
      return { ok: false, error: "Invalid branch name" };
    }
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const result = await spawn(["git", "checkout", branch], { cwd });
    log("info", "git", `Checkout branch: ${branch}`, { projectId });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  });

  // Detect sub-repos
  fastify.get("/projects/:projectId/git/sub-repos", async (request) => {
    const { projectId } = request.params as any;
    const projectPath = getProjectPath(projectId);
    const subRepos: string[] = [];

    if (fs.existsSync(path.join(projectPath, ".git"))) {
      subRepos.push("");
    }

    try {
      const entries = fs.readdirSync(projectPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && fs.existsSync(path.join(projectPath, entry.name, ".git"))) {
          subRepos.push(entry.name);
        }
      }
    } catch {}

    return subRepos;
  });
};

export default gitRoutes;
