import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  
});

describe("GitHub Accounts API", () => {
  const uniqueSuffix = Date.now();
  let createdAccountId: string;

  test("POST /api/github-accounts — create account with name + token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/github-accounts",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `Test Account ${uniqueSuffix}`,
        token: `ghp_test_token_${uniqueSuffix}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe(`Test Account ${uniqueSuffix}`);
    expect(body.hasToken).toBe(true);
    expect(body.createdAt).toBeDefined();
    // Token should NOT be in the response
    expect(body.token).toBeUndefined();

    createdAccountId = body.id;
  });

  test("GET /api/github-accounts — list accounts includes created account", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/github-accounts",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);

    const found = body.find((a: any) => a.id === createdAccountId);
    expect(found).toBeDefined();
    expect(found.name).toBe(`Test Account ${uniqueSuffix}`);
    expect(found.hasToken).toBe(true);
    // Token must NOT be exposed in list response
    expect(found.token).toBeUndefined();
  });

  test("PATCH /api/github-accounts/:id — update name", async () => {
    const updatedName = `Updated Account ${uniqueSuffix}`;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/github-accounts/${createdAccountId}`,
      headers: { "Content-Type": "application/json" },
      payload: { name: updatedName },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(createdAccountId);
    expect(body.name).toBe(updatedName);
    expect(body.hasToken).toBe(true);
    expect(body.createdAt).toBeDefined();
  });

  test("PATCH /api/github-accounts/:id — update token", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/github-accounts/${createdAccountId}`,
      headers: { "Content-Type": "application/json" },
      payload: { token: `ghp_new_token_${uniqueSuffix}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(createdAccountId);
    expect(body.hasToken).toBe(true);
    // Token should NOT be in the response
    expect(body.token).toBeUndefined();
  });

  test("PATCH /api/github-accounts/:id — returns 404 for non-existent account", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/github-accounts/non-existent-id-12345",
      headers: { "Content-Type": "application/json" },
      payload: { name: "No Such Account" },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Account not found");
  });

  test("DELETE /api/github-accounts/:id — delete account", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/github-accounts/${createdAccountId}`,
    });

    expect(res.statusCode).toBe(204);
  });

  test("GET /api/github-accounts — deleted account is gone", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/github-accounts",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const found = body.find((a: any) => a.id === createdAccountId);
    expect(found).toBeUndefined();
  });
});

describe("Project GitHub Mappings API", () => {
  const uniqueSuffix = Date.now();
  let projectId: string;
  let accountId: string;

  beforeAll(async () => {
    // Create a project to use for mapping tests
    const projectRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `GitHub Mapping Test Project ${uniqueSuffix}`,
        path: `/tmp/test-gh-mapping-${uniqueSuffix}`,
      },
    });
    projectId = projectRes.json().id;

    // Create a GitHub account to map
    const accountRes = await app.inject({
      method: "POST",
      url: "/api/github-accounts",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `Mapping Test Account ${uniqueSuffix}`,
        token: `ghp_mapping_test_${uniqueSuffix}`,
      },
    });
    accountId = accountRes.json().id;
  });

  afterAll(async () => {
    // Clean up: delete mapping, account, and project
    await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/github-mapping`,
      headers: { "Content-Type": "application/json" },
      payload: { subPath: "" },
    });
    await app.inject({
      method: "DELETE",
      url: `/api/github-accounts/${accountId}`,
    });
    await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}`,
    });
  });

  test("PUT /api/projects/:projectId/github-mapping — create mapping", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/github-mapping`,
      headers: { "Content-Type": "application/json" },
      payload: {
        githubAccountId: accountId,
        subPath: "",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projectId).toBe(projectId);
    expect(body.githubAccountId).toBe(accountId);
    expect(body.subPath).toBe("");
  });

  test("GET /api/projects/:projectId/github-mapping — list mappings", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/github-mapping`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const found = body.find((m: any) => m.githubAccountId === accountId);
    expect(found).toBeDefined();
    expect(found.projectId).toBe(projectId);
    expect(found.accountName).toBe(`Mapping Test Account ${uniqueSuffix}`);
  });

  test("DELETE /api/projects/:projectId/github-mapping — delete mapping", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/github-mapping`,
      headers: { "Content-Type": "application/json" },
      payload: { subPath: "" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);

    // Verify mapping is gone
    const listRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/github-mapping`,
    });
    const mappings = listRes.json();
    const found = mappings.find((m: any) => m.githubAccountId === accountId);
    expect(found).toBeUndefined();
  });
});

describe("CI Status API — validation and error paths", () => {
  const uniqueSuffix = Date.now();
  let projectId: string;

  beforeAll(async () => {
    // Create a project for CI status tests
    const projectRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `CI Status Test Project ${uniqueSuffix}`,
        path: `/tmp/test-ci-status-${uniqueSuffix}`,
      },
    });
    projectId = projectRes.json().id;
  });

  afterAll(async () => {
    await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}`,
    });
  });

  test("GET /api/projects/:id/ci-status without branch param returns 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/ci-status`,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("branch query param required");
  });

  test("GET /api/projects/:id/ci-status without GitHub mapping returns 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/ci-status?branch=main`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("No GitHub account mapped for this project");
  });

  test("GET /api/projects/:id/ci-status with non-existent project returns 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/non-existent-project-id/ci-status?branch=main`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    // No mapping exists for a non-existent project, so this returns the mapping error
    expect(body.error).toBe("No GitHub account mapped for this project");
  });

  test("POST /api/projects/:id/ci-status/batch without branches array returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/ci-status/batch`,
      headers: { "Content-Type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("branches array required");
  });

  test("POST /api/projects/:id/ci-status/batch with empty branches array returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/ci-status/batch`,
      headers: { "Content-Type": "application/json" },
      payload: { branches: [] },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("branches array required");
  });

  test("POST /api/projects/:id/ci-status/batch with non-array branches returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/ci-status/batch`,
      headers: { "Content-Type": "application/json" },
      payload: { branches: "main" },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("branches array required");
  });

  test("POST /api/projects/:id/ci-status/batch without GitHub mapping returns 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/ci-status/batch`,
      headers: { "Content-Type": "application/json" },
      payload: { branches: ["main", "dev"] },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("No GitHub account mapped");
  });
});

describe("CI Status API — with mapping + git repo (GitHub API unreachable)", () => {
  const uniqueSuffix = Date.now();
  let projectId: string;
  let accountId: string;
  let tmpDir: string;

  beforeAll(async () => {
    // Create a temp git repo with a GitHub remote
    tmpDir = mkdtempSync(join(tmpdir(), "ci-test-"));
    execSync("git init", { cwd: tmpDir });
    execSync("git remote add origin https://github.com/test-owner/test-repo.git", { cwd: tmpDir });

    // Create project pointing to this temp dir
    const projectRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `CI Deep Test ${uniqueSuffix}`,
        path: tmpDir,
      },
    });
    projectId = projectRes.json().id;

    // Create a GitHub account
    const accountRes = await app.inject({
      method: "POST",
      url: "/api/github-accounts",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `CI Deep Account ${uniqueSuffix}`,
        token: `ghp_fake_token_for_ci_test_${uniqueSuffix}`,
      },
    });
    accountId = accountRes.json().id;

    // Map the account to the project
    await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/github-mapping`,
      headers: { "Content-Type": "application/json" },
      payload: { githubAccountId: accountId, subPath: "" },
    });
  });

  afterAll(async () => {
    await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/github-mapping`,
      headers: { "Content-Type": "application/json" },
      payload: { subPath: "" },
    });
    await app.inject({ method: "DELETE", url: `/api/github-accounts/${accountId}` });
    await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test("GET ci-status — exercises token decrypt, repo detection, returns error from GitHub API", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/ci-status?branch=main`,
    });

    // GitHub API will reject the fake token — expect either 401 or 500
    const body = res.json();
    expect([401, 500]).toContain(res.statusCode);
    expect(body.error).toBeDefined();
  });

  test("POST ci-status/batch — exercises token decrypt, repo detection, returns results", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/ci-status/batch`,
      headers: { "Content-Type": "application/json" },
      payload: { branches: ["main", "develop"] },
    });

    // Batch endpoint catches errors per-branch and returns unknown status
    // It may return 200 with unknown statuses, or the outer try may fail
    if (res.statusCode === 200) {
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);
      for (const result of body) {
        expect(result.branch).toBeDefined();
        expect(result.status).toBeDefined();
      }
    } else {
      // If the whole thing errored, it should still be a valid error response
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  test("GET ci-status with orphaned mapping (project row gone) returns 404 'Project not found'", async () => {
    // The mapping table has ON DELETE CASCADE from projects, so we need to
    // temporarily disable FK enforcement to create an orphaned mapping.
    const { getDb } = await import("../db");
    const db = getDb();

    const fakeProjectId = "orphan-proj-" + uniqueSuffix;

    // Create a temp account for this test
    const fakeAccountRes = await app.inject({
      method: "POST",
      url: "/api/github-accounts",
      headers: { "Content-Type": "application/json" },
      payload: { name: `Orphan Acct ${uniqueSuffix}`, token: `ghp_orphan_${uniqueSuffix}` },
    });
    const fakeAccountId = fakeAccountRes.json().id;

    // Get the encrypted token from the account row
    db.prepare("SELECT token FROM github_accounts WHERE id = ?").get(fakeAccountId);

    // Disable FK checks, insert orphaned mapping, re-enable FK checks
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare(
      "INSERT INTO project_github_mappings (projectId, subPath, githubAccountId) VALUES (?, '', ?)",
    ).run(fakeProjectId, fakeAccountId);
    db.exec("PRAGMA foreign_keys = ON");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${fakeProjectId}/ci-status?branch=main`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Project not found");

    // Also test batch with same orphaned mapping
    const batchRes = await app.inject({
      method: "POST",
      url: `/api/projects/${fakeProjectId}/ci-status/batch`,
      headers: { "Content-Type": "application/json" },
      payload: { branches: ["main"] },
    });

    expect(batchRes.statusCode).toBe(404);
    expect(batchRes.json().error).toBe("Project not found");

    // Cleanup
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("DELETE FROM project_github_mappings WHERE projectId = ?").run(fakeProjectId);
    db.exec("PRAGMA foreign_keys = ON");
    await app.inject({ method: "DELETE", url: `/api/github-accounts/${fakeAccountId}` });
  });

  test("GET ci-status — repo without github remote returns 404", async () => {
    // Create a temp repo with a non-GitHub remote
    const nonGhDir = mkdtempSync(join(tmpdir(), "ci-non-gh-"));
    execSync("git init", { cwd: nonGhDir });
    execSync("git remote add origin https://gitlab.com/test/repo.git", { cwd: nonGhDir });

    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: `Non-GH ${uniqueSuffix}`, path: nonGhDir },
    });
    const projId = projRes.json().id;

    // Map same account
    await app.inject({
      method: "PUT",
      url: `/api/projects/${projId}/github-mapping`,
      headers: { "Content-Type": "application/json" },
      payload: { githubAccountId: accountId, subPath: "" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projId}/ci-status?branch=main`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Could not determine GitHub repo from git remote");

    // Also test batch
    const batchRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projId}/ci-status/batch`,
      headers: { "Content-Type": "application/json" },
      payload: { branches: ["main"] },
    });

    expect(batchRes.statusCode).toBe(404);
    expect(batchRes.json().error).toBe("Could not determine GitHub repo");

    // Cleanup
    await app.inject({
      method: "DELETE",
      url: `/api/projects/${projId}/github-mapping`,
      headers: { "Content-Type": "application/json" },
      payload: { subPath: "" },
    });
    await app.inject({ method: "DELETE", url: `/api/projects/${projId}` });
    try { rmSync(nonGhDir, { recursive: true, force: true }); } catch {}
  });

  test("GET ci-status — project path that does not exist (git fails) returns 404", async () => {
    // Create a project with a non-existent path
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: `Bad Path ${uniqueSuffix}`, path: `/tmp/nonexistent-path-${uniqueSuffix}` },
    });
    const projId = projRes.json().id;

    // Map same account
    await app.inject({
      method: "PUT",
      url: `/api/projects/${projId}/github-mapping`,
      headers: { "Content-Type": "application/json" },
      payload: { githubAccountId: accountId, subPath: "" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projId}/ci-status?branch=main`,
    });

    // git command fails silently, repoFullName stays null → 404
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("Could not determine GitHub repo");

    // Cleanup
    await app.inject({
      method: "DELETE",
      url: `/api/projects/${projId}/github-mapping`,
      headers: { "Content-Type": "application/json" },
      payload: { subPath: "" },
    });
    await app.inject({ method: "DELETE", url: `/api/projects/${projId}` });
  });
});
