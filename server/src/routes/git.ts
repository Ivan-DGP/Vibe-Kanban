import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { spawn } from "../lib/spawn";
import { log } from "../lib/logger";
import path from "node:path";
import fs from "node:fs";

function resolveGitCwd(projectPath: string, subPath?: string): string {
  if (!subPath) return projectPath;
  const resolved = path.resolve(projectPath, subPath);
  if (!resolved.startsWith(path.resolve(projectPath))) {
    throw new Error("Invalid subPath");
  }
  return resolved;
}

function getProjectPath(projectId: string): string {
  const db = getDb();
  const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) throw new Error("Project not found");
  return project.path;
}

function parseStatus(stdout: string) {
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
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const result = await spawn(["git", "status", "--porcelain=v2", "--branch"], { cwd });
    if (result.exitCode !== 0) return { branch: "", upstream: null, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] };
    return parseStatus(result.stdout);
  });

  fastify.get("/projects/:projectId/git/log", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.query as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const result = await spawn(
      ["git", "log", "--oneline", "-30", "--format=%H|%h|%an|%aI|%s"],
      { cwd },
    );
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
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const result = await spawn(
      ["git", "branch", "-a", "--format=%(refname:short)|%(HEAD)"],
      { cwd },
    );
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
    const args = files && files.length ? ["git", "add", ...files] : ["git", "add", "-A"];
    const result = await spawn(args, { cwd });
    log("info", "git", "Staged files", { projectId, files });
    return { ok: result.exitCode === 0, stderr: result.stderr };
  });

  fastify.post("/projects/:projectId/git/unstage", async (request) => {
    const { projectId } = request.params as any;
    const { files, subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const args = files && files.length ? ["git", "reset", "HEAD", ...files] : ["git", "reset", "HEAD"];
    const result = await spawn(args, { cwd });
    return { ok: result.exitCode === 0, stderr: result.stderr };
  });

  fastify.post("/projects/:projectId/git/commit", async (request) => {
    const { projectId } = request.params as any;
    const { message, subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const result = await spawn(["git", "commit", "-m", message], { cwd });
    log("info", "git", `Commit: ${message}`, { projectId });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  });

  fastify.post("/projects/:projectId/git/push", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const result = await spawn(["git", "push"], { cwd, timeout: 30000 });
    log("info", "git", "Push", { projectId });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  });

  fastify.post("/projects/:projectId/git/pull", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const result = await spawn(["git", "pull"], { cwd, timeout: 30000 });
    log("info", "git", "Pull", { projectId });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  });

  fastify.post("/projects/:projectId/git/discard", async (request) => {
    const { projectId } = request.params as any;
    const { files, subPath } = request.body as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    if (files && files.length) {
      await spawn(["git", "checkout", "--", ...files], { cwd });
    } else {
      await spawn(["git", "checkout", "--", "."], { cwd });
    }
    log("warn", "git", "Discarded changes", { projectId, files });
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
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    const args = ["git", "diff"];
    if (staged === "true") args.push("--cached");
    if (file) args.push(file);
    const result = await spawn(args, { cwd });
    return result.stdout;
  });

  // Main branch divergence
  fastify.get("/projects/:projectId/git/divergence", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.query as any;
    const cwd = resolveGitCwd(getProjectPath(projectId), subPath);
    // Try main, then master
    for (const main of ["main", "master"]) {
      const check = await spawn(["git", "rev-parse", "--verify", main], { cwd });
      if (check.exitCode === 0) {
        const result = await spawn(["git", "rev-list", "--left-right", "--count", `${main}...HEAD`], { cwd });
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
    if (!branch || typeof branch !== "string" || /[;&|`$]/.test(branch)) {
      return { ok: false, error: "Invalid branch name" };
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
    if (!branch || typeof branch !== "string" || /[;&|`$]/.test(branch)) {
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
