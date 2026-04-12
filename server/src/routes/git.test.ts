import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolveGitCwd, parseStatus } from "./git";
import { buildApp } from "../app";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

// =============================================================================
// Pure function tests: parseStatus
// =============================================================================

describe("parseStatus", () => {
  test("parses branch name from # branch.head", () => {
    const result = parseStatus("# branch.head main\n");
    expect(result.branch).toBe("main");
  });

  test("parses upstream from # branch.upstream", () => {
    const result = parseStatus("# branch.upstream origin/main\n");
    expect(result.upstream).toBe("origin/main");
  });

  test("parses ahead/behind from # branch.ab", () => {
    const result = parseStatus("# branch.ab +2 -1\n");
    expect(result.ahead).toBe(2);
    expect(result.behind).toBe(1);
  });

  test("parses staged files (xy[0] != '.')", () => {
    // "1 M. N... 100644 100644 100644 abc123 def456 file.txt"
    const result = parseStatus("1 M. N... 100644 100644 100644 abc123 def456 file.txt\n");
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0].path).toBe("file.txt");
    expect(result.staged[0].status).toBe("M");
    expect(result.unstaged).toHaveLength(0);
  });

  test("parses unstaged files (xy[1] != '.')", () => {
    // "1 .M N... 100644 100644 100644 abc123 def456 file.txt"
    const result = parseStatus("1 .M N... 100644 100644 100644 abc123 def456 file.txt\n");
    expect(result.unstaged).toHaveLength(1);
    expect(result.unstaged[0].path).toBe("file.txt");
    expect(result.unstaged[0].status).toBe("M");
    expect(result.staged).toHaveLength(0);
  });

  test("parses both staged and unstaged from same file", () => {
    // "1 MM N... 100644 100644 100644 abc123 def456 file.txt"
    const result = parseStatus("1 MM N... 100644 100644 100644 abc123 def456 file.txt\n");
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0].status).toBe("M");
    expect(result.unstaged).toHaveLength(1);
    expect(result.unstaged[0].status).toBe("M");
  });

  test("parses untracked files (lines starting with '? ')", () => {
    const result = parseStatus("? newfile.txt\n");
    expect(result.untracked).toHaveLength(1);
    expect(result.untracked[0]).toBe("newfile.txt");
  });

  test("parses renamed files (lines starting with '2 ')", () => {
    // "2 R. N... 100644 100644 100644 abc123 def456 R100\tnew.txt\told.txt"
    const result = parseStatus("2 R. N... 100644 100644 100644 abc123 def456 R100\tnew.txt\told.txt\n");
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0].status).toBe("R");
    // The path for renamed files: line.split("\t")[1]
    expect(result.staged[0].path).toBe("new.txt");
  });

  test("empty stdout returns default empty result", () => {
    const result = parseStatus("");
    expect(result.branch).toBe("");
    expect(result.upstream).toBeNull();
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(0);
    expect(result.staged).toHaveLength(0);
    expect(result.unstaged).toHaveLength(0);
    expect(result.untracked).toHaveLength(0);
  });

  test("handles multiple files of different types", () => {
    const stdout = [
      "# branch.head feature/test",
      "# branch.upstream origin/feature/test",
      "# branch.ab +3 -0",
      "1 M. N... 100644 100644 100644 abc123 def456 staged.txt",
      "1 .M N... 100644 100644 100644 abc123 def456 unstaged.txt",
      "? untracked1.txt",
      "? untracked2.txt",
      "2 R. N... 100644 100644 100644 abc123 def456 R100\trenamed.txt\told.txt",
    ].join("\n");

    const result = parseStatus(stdout);
    expect(result.branch).toBe("feature/test");
    expect(result.upstream).toBe("origin/feature/test");
    expect(result.ahead).toBe(3);
    expect(result.behind).toBe(0);
    expect(result.staged).toHaveLength(2); // staged.txt + renamed.txt
    expect(result.unstaged).toHaveLength(1); // unstaged.txt
    expect(result.untracked).toHaveLength(2); // untracked1.txt + untracked2.txt
  });
});

// =============================================================================
// Pure function tests: resolveGitCwd
// =============================================================================

describe("resolveGitCwd", () => {
  test("returns projectPath when no subPath", () => {
    const result = resolveGitCwd("/home/user/project");
    expect(result).toBe("/home/user/project");
  });

  test("resolves subPath correctly", () => {
    const result = resolveGitCwd("/home/user/project", "packages/server");
    expect(result).toBe(path.resolve("/home/user/project", "packages/server"));
  });

  test("throws on path traversal", () => {
    expect(() => {
      resolveGitCwd("/home/user/project", "../../../etc");
    }).toThrow("Invalid subPath");
  });

  test("returns projectPath when subPath is undefined", () => {
    const result = resolveGitCwd("/some/path", undefined);
    expect(result).toBe("/some/path");
  });

  test("returns projectPath when subPath is empty string", () => {
    const result = resolveGitCwd("/some/path", "");
    expect(result).toBe("/some/path");
  });
});

// =============================================================================
// Integration tests: Git routes with a real temp repo
// =============================================================================

describe("Git route integration", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let projectId: string;
  let tmpDir: string;

  beforeAll(async () => {
    // Create a temp directory with a real git repo
    tmpDir = path.join("/tmp", `git-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Initialize git repo and create a commit
    execSync("git init", { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test User"', { cwd: tmpDir });

    // Create and commit a file so the repo has state
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Repo\n");
    execSync("git add README.md", { cwd: tmpDir });
    execSync('git commit -m "Initial commit"', { cwd: tmpDir });

    // Build the app and create a project pointing to the temp repo
    app = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: "Git Test Project", path: tmpDir },
    });
    projectId = res.json().id;
  });

  afterAll(async () => {
    // Clean up project and app
    if (app && projectId) {
      await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
      await app.close();
    }
    // Remove temp directory
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("GET /api/projects/:id/git/status - returns branch and file arrays", async () => {
    // Add an untracked file so status has something to report
    fs.writeFileSync(path.join(tmpDir, "untracked.txt"), "hello\n");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/status`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.branch).toBe("string");
    expect(body.branch.length).toBeGreaterThan(0); // should be "main" or "master"
    expect(Array.isArray(body.staged)).toBe(true);
    expect(Array.isArray(body.unstaged)).toBe(true);
    expect(Array.isArray(body.untracked)).toBe(true);
    // We created an untracked file
    expect(body.untracked).toContain("untracked.txt");

    // Clean up the untracked file
    fs.unlinkSync(path.join(tmpDir, "untracked.txt"));
  });

  test("GET /api/projects/:id/git/log - returns commit history array", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/log`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const commit = body[0];
    expect(commit.hash).toBeDefined();
    expect(typeof commit.hash).toBe("string");
    expect(commit.hash.length).toBe(40); // full SHA
    expect(commit.hashShort).toBeDefined();
    expect(commit.author).toBe("Test User");
    expect(commit.message).toBe("Initial commit");
    expect(commit.date).toBeDefined();
  });

  test("GET /api/projects/:id/git/branches - returns branches array", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/branches`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const branch = body[0];
    expect(branch.name).toBeDefined();
    expect(typeof branch.current).toBe("boolean");
    expect(typeof branch.remote).toBe("boolean");
    // The default branch should be current
    const currentBranch = body.find((b: any) => b.current);
    expect(currentBranch).toBeDefined();
  });
});
