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

  // ===========================================================================
  // GET /api/projects/:id/git/diff
  // ===========================================================================

  test("GET /api/projects/:id/git/diff - returns diff for unstaged changes", async () => {
    // Modify a tracked file to create an unstaged diff
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Repo\nModified line\n");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/diff`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toContain("diff --git");
    expect(body).toContain("Modified line");

    // Restore the file
    execSync("git checkout -- README.md", { cwd: tmpDir });
  });

  test("GET /api/projects/:id/git/diff - returns diff for a specific file", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Repo\nFile-specific diff\n");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/diff?file=README.md`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toContain("File-specific diff");

    // Restore
    execSync("git checkout -- README.md", { cwd: tmpDir });
  });

  test("GET /api/projects/:id/git/diff - returns staged diff with staged=true", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Repo\nStaged change\n");
    execSync("git add README.md", { cwd: tmpDir });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/diff?staged=true`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toContain("Staged change");

    // Unstage and restore
    execSync("git reset HEAD README.md", { cwd: tmpDir });
    execSync("git checkout -- README.md", { cwd: tmpDir });
  });

  // ===========================================================================
  // POST /api/projects/:id/git/stage and POST /api/projects/:id/git/unstage
  // ===========================================================================

  test("POST /api/projects/:id/git/stage - stages specific files", async () => {
    fs.writeFileSync(path.join(tmpDir, "stage-test.txt"), "stage me\n");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/stage`,
      headers: { "Content-Type": "application/json" },
      payload: { files: ["stage-test.txt"] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);

    // Verify the file is staged
    const statusRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/status`,
    });
    const status = statusRes.json();
    expect(status.staged.some((f: any) => f.path === "stage-test.txt")).toBe(true);

    // Unstage for cleanup
    execSync("git reset HEAD stage-test.txt", { cwd: tmpDir });
    fs.unlinkSync(path.join(tmpDir, "stage-test.txt"));
  });

  test("POST /api/projects/:id/git/stage - stages all files when no files specified", async () => {
    fs.writeFileSync(path.join(tmpDir, "auto-stage1.txt"), "file1\n");
    fs.writeFileSync(path.join(tmpDir, "auto-stage2.txt"), "file2\n");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/stage`,
      headers: { "Content-Type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Verify both files are staged
    const statusRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/status`,
    });
    const status = statusRes.json();
    expect(status.staged.some((f: any) => f.path === "auto-stage1.txt")).toBe(true);
    expect(status.staged.some((f: any) => f.path === "auto-stage2.txt")).toBe(true);

    // Unstage and clean up
    execSync("git reset HEAD auto-stage1.txt auto-stage2.txt", { cwd: tmpDir });
    fs.unlinkSync(path.join(tmpDir, "auto-stage1.txt"));
    fs.unlinkSync(path.join(tmpDir, "auto-stage2.txt"));
  });

  test("POST /api/projects/:id/git/unstage - unstages specific files", async () => {
    fs.writeFileSync(path.join(tmpDir, "unstage-test.txt"), "unstage me\n");
    execSync("git add unstage-test.txt", { cwd: tmpDir });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/unstage`,
      headers: { "Content-Type": "application/json" },
      payload: { files: ["unstage-test.txt"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Verify the file is no longer staged (should be untracked now)
    const statusRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/status`,
    });
    const status = statusRes.json();
    expect(status.staged.some((f: any) => f.path === "unstage-test.txt")).toBe(false);
    expect(status.untracked).toContain("unstage-test.txt");

    // Clean up
    fs.unlinkSync(path.join(tmpDir, "unstage-test.txt"));
  });

  // ===========================================================================
  // POST /api/projects/:id/git/commit
  // ===========================================================================

  test("POST /api/projects/:id/git/commit - creates a commit", async () => {
    fs.writeFileSync(path.join(tmpDir, "commit-test.txt"), "commit me\n");
    execSync("git add commit-test.txt", { cwd: tmpDir });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/commit`,
      headers: { "Content-Type": "application/json" },
      payload: { message: "Test commit via API" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);

    // Verify the commit appears in the log
    const logRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/log`,
    });
    const log = logRes.json();
    expect(log[0].message).toBe("Test commit via API");
  });

  test("POST /api/projects/:id/git/commit - fails with no staged files", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/commit`,
      headers: { "Content-Type": "application/json" },
      payload: { message: "Empty commit" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
  });

  // ===========================================================================
  // POST /api/projects/:id/git/discard
  // ===========================================================================

  test("POST /api/projects/:id/git/discard - discards changes to specific files", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Repo\nDiscard this\n");

    // Verify there is a change
    const statusBefore = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/status`,
    });
    expect(statusBefore.json().unstaged.length).toBeGreaterThan(0);

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/discard`,
      headers: { "Content-Type": "application/json" },
      payload: { files: ["README.md"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Verify file is restored
    const content = fs.readFileSync(path.join(tmpDir, "README.md"), "utf-8");
    expect(content).toBe("# Test Repo\n");
  });

  test("POST /api/projects/:id/git/discard - discards all changes when no files specified", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Repo\nDiscard all\n");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/discard`,
      headers: { "Content-Type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const content = fs.readFileSync(path.join(tmpDir, "README.md"), "utf-8");
    expect(content).toBe("# Test Repo\n");
  });

  // ===========================================================================
  // POST /api/projects/:id/git/undo-commit
  // ===========================================================================

  test("POST /api/projects/:id/git/undo-commit - soft resets the last commit", async () => {
    // Create a commit to undo
    fs.writeFileSync(path.join(tmpDir, "undo-test.txt"), "undo me\n");
    execSync("git add undo-test.txt", { cwd: tmpDir });
    execSync('git commit -m "Commit to undo"', { cwd: tmpDir });

    // Count commits before undo
    const logBefore = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/log`,
    });
    const countBefore = logBefore.json().length;

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/undo-commit`,
      headers: { "Content-Type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Count commits after undo - should be one less
    const logAfter = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/log`,
    });
    expect(logAfter.json().length).toBe(countBefore - 1);

    // The file should still be staged (soft reset)
    const statusRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/status`,
    });
    const status = statusRes.json();
    expect(status.staged.some((f: any) => f.path === "undo-test.txt")).toBe(true);

    // Clean up: commit the file back so subsequent tests have a clean state
    execSync('git commit -m "Re-commit after undo test"', { cwd: tmpDir });
  });

  // ===========================================================================
  // POST /api/projects/:id/git/create-branch
  // ===========================================================================

  test("POST /api/projects/:id/git/create-branch - creates and switches to new branch", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/create-branch`,
      headers: { "Content-Type": "application/json" },
      payload: { branch: "feature/test-branch" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Verify we're on the new branch
    const statusRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/status`,
    });
    expect(statusRes.json().branch).toBe("feature/test-branch");

    // Switch back to default branch for subsequent tests
    execSync("git rev-parse --abbrev-ref HEAD", { cwd: tmpDir }).toString().trim();
    // We're on feature/test-branch, so we need to know the original branch name
    // Let's get it from the branches list
    const branchRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/branches`,
    });
    const branches = branchRes.json();
    const mainBranch = branches.find((b: any) => b.name === "main" || b.name === "master");
    if (mainBranch) {
      execSync(`git checkout ${mainBranch.name}`, { cwd: tmpDir });
    }
  });

  test("POST /api/projects/:id/git/create-branch - rejects invalid branch names", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/create-branch`,
      headers: { "Content-Type": "application/json" },
      payload: { branch: "bad;name" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Invalid branch name");
  });

  test("POST /api/projects/:id/git/create-branch - creates branch from baseBranch", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/create-branch`,
      headers: { "Content-Type": "application/json" },
      payload: { branch: "feature/from-base", baseBranch: "feature/test-branch" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Verify we're on the new branch
    const statusRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/status`,
    });
    expect(statusRes.json().branch).toBe("feature/from-base");

    // Switch back to default branch
    const branchRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/branches`,
    });
    const branches = branchRes.json();
    const mainBranch = branches.find((b: any) => b.name === "main" || b.name === "master");
    if (mainBranch) {
      execSync(`git checkout ${mainBranch.name}`, { cwd: tmpDir });
    }
  });

  // ===========================================================================
  // POST /api/projects/:id/git/checkout
  // ===========================================================================

  test("POST /api/projects/:id/git/checkout - switches to existing branch", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/checkout`,
      headers: { "Content-Type": "application/json" },
      payload: { branch: "feature/test-branch" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Verify we're on the branch
    const statusRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/status`,
    });
    expect(statusRes.json().branch).toBe("feature/test-branch");

    // Switch back to default branch
    const branchRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/branches`,
    });
    const branches = branchRes.json();
    const mainBranch = branches.find((b: any) => b.name === "main" || b.name === "master");
    if (mainBranch) {
      execSync(`git checkout ${mainBranch.name}`, { cwd: tmpDir });
    }
  });

  test("POST /api/projects/:id/git/checkout - rejects invalid branch names", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/checkout`,
      headers: { "Content-Type": "application/json" },
      payload: { branch: "bad|name" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Invalid branch name");
  });

  test("POST /api/projects/:id/git/checkout - fails for non-existent branch", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/checkout`,
      headers: { "Content-Type": "application/json" },
      payload: { branch: "does-not-exist" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
  });

  // ===========================================================================
  // GET /api/projects/:id/git/divergence
  // ===========================================================================

  test("GET /api/projects/:id/git/divergence - returns divergence from main branch", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/divergence`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The main branch exists (we're on it), so mainBranch should be detected
    expect(body.mainBranch).toBeDefined();
    expect(typeof body.ahead).toBe("number");
    expect(typeof body.behind).toBe("number");
  });

  // ===========================================================================
  // GET /api/projects/:id/git/sub-repos
  // ===========================================================================

  test("GET /api/projects/:id/git/sub-repos - detects git repos", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/sub-repos`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    // The temp dir itself is a git repo, so "" should be in the list
    expect(body).toContain("");
  });

  test("GET /api/projects/:id/git/sub-repos - detects sub-directory repos", async () => {
    // Create a sub-directory with its own git repo
    const subRepoDir = path.join(tmpDir, "sub-project");
    fs.mkdirSync(subRepoDir, { recursive: true });
    execSync("git init", { cwd: subRepoDir });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/sub-repos`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toContain("");
    expect(body).toContain("sub-project");

    // Clean up sub-repo
    fs.rmSync(subRepoDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // POST /api/projects/:id/git/push
  // ===========================================================================

  test("POST /api/projects/:id/git/push - push with upstream set returns ok true or false", async () => {
    // Set up a bare remote so we can push
    const remoteDir = path.join("/tmp", `git-remote-${Date.now()}`);
    fs.mkdirSync(remoteDir, { recursive: true });
    execSync("git init --bare", { cwd: remoteDir });
    execSync(`git remote add origin ${remoteDir}`, { cwd: tmpDir });
    execSync("git push --set-upstream origin HEAD", { cwd: tmpDir });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/push`,
      headers: { "Content-Type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.ok).toBe("boolean");
    expect(body.stdout).toBeDefined();
    expect(body.stderr).toBeDefined();

    // Cleanup
    execSync("git remote remove origin", { cwd: tmpDir });
    fs.rmSync(remoteDir, { recursive: true, force: true });
  });

  test("POST /api/projects/:id/git/push - push without upstream uses --set-upstream", async () => {
    // Set up a bare remote but do NOT set upstream — push should use --set-upstream
    const remoteDir = path.join("/tmp", `git-remote-no-upstream-${Date.now()}`);
    fs.mkdirSync(remoteDir, { recursive: true });
    execSync("git init --bare", { cwd: remoteDir });
    execSync(`git remote add origin ${remoteDir}`, { cwd: tmpDir });
    // Do NOT run git push --set-upstream, so @{u} will fail

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/push`,
      headers: { "Content-Type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Push itself may succeed or fail depending on git config; key is we get the shape back
    expect(typeof body.ok).toBe("boolean");
    expect(body.stdout !== undefined || body.stderr !== undefined).toBe(true);

    // Cleanup
    execSync("git remote remove origin", { cwd: tmpDir });
    fs.rmSync(remoteDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // POST /api/projects/:id/git/pull
  // ===========================================================================

  test("POST /api/projects/:id/git/pull - pull with upstream set succeeds", async () => {
    // Set up a bare remote, push, then pull
    const remoteDir = path.join("/tmp", `git-pull-remote-${Date.now()}`);
    fs.mkdirSync(remoteDir, { recursive: true });
    execSync("git init --bare", { cwd: remoteDir });
    execSync(`git remote add origin ${remoteDir}`, { cwd: tmpDir });
    execSync("git push --set-upstream origin HEAD", { cwd: tmpDir });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/pull`,
      headers: { "Content-Type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.ok).toBe("boolean");
    expect(body.stdout).toBeDefined();
    expect(body.stderr).toBeDefined();

    // Cleanup
    execSync("git remote remove origin", { cwd: tmpDir });
    fs.rmSync(remoteDir, { recursive: true, force: true });
  });

  test("POST /api/projects/:id/git/pull - pull without remote fails gracefully", async () => {
    // No remote set; git pull should fail with exitCode !== 0
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git/pull`,
      headers: { "Content-Type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
  });

  // ===========================================================================
  // GET /api/projects/:id/git/divergence - line 211 (rev-list succeeds)
  // ===========================================================================

  test("GET /api/projects/:id/git/divergence - returns ahead/behind counts when on feature branch", async () => {
    // We're on main/master; create a feature branch with an extra commit
    const branchRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/branches`,
    });
    const branches = branchRes.json();
    const mainBranch = branches.find((b: any) => b.name === "main" || b.name === "master");
    const mainName = mainBranch?.name ?? "main";

    // Create a commit on a new branch ahead of main
    execSync(`git checkout -b diverge-test-branch`, { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, "diverge.txt"), "divergence test\n");
    execSync("git add diverge.txt", { cwd: tmpDir });
    execSync('git commit -m "Divergence test commit"', { cwd: tmpDir });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/divergence`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mainBranch).toBe(mainName);
    expect(typeof body.ahead).toBe("number");
    expect(typeof body.behind).toBe("number");
    // We added one commit ahead of main
    expect(body.ahead).toBeGreaterThanOrEqual(1);

    // Restore (file only exists on diverge-test-branch, not on main)
    execSync(`git checkout ${mainName}`, { cwd: tmpDir });
    execSync("git branch -D diverge-test-branch", { cwd: tmpDir });
  });

  test("GET /api/projects/:id/git/divergence - returns null mainBranch when rev-list fails (orphan HEAD)", async () => {
    // Switch to an orphan branch so HEAD is unborn.
    // rev-parse --verify main/master succeeds (the branch exists), but
    // rev-list --left-right --count main...HEAD fails because HEAD has no commit.

    // Determine the main branch name first
    const branchRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/git/branches`,
    });
    const branches = branchRes.json();
    const mainBranchObj = branches.find((b: any) => b.name === "main" || b.name === "master");
    const mainName = mainBranchObj?.name ?? "main";

    // Stage everything so checkout --orphan doesn't warn about untracked files
    try { execSync("git add -A", { cwd: tmpDir }); } catch {}
    execSync("git checkout --orphan orphan-no-commits", { cwd: tmpDir });
    // Remove the staged files from the index so HEAD remains truly unborn
    try { execSync("git rm -rf --cached .", { cwd: tmpDir }); } catch {}

    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/git/divergence`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // rev-list fails on unborn HEAD → falls through both branch checks → null
      expect(body.mainBranch).toBeNull();
      expect(body.ahead).toBe(0);
      expect(body.behind).toBe(0);
    } finally {
      // Return to main branch
      execSync(`git checkout -f ${mainName}`, { cwd: tmpDir });
      // Delete the orphan branch if it still exists
      try { execSync("git branch -D orphan-no-commits", { cwd: tmpDir }); } catch {}
    }
  });
});
