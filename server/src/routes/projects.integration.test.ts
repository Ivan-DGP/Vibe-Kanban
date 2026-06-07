import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";
import { detectTechStack, scanDirectory } from "./projects";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let app: Awaited<ReturnType<typeof buildApp>>;

// /browse and /projects/scan are confined to an allowlist of roots. Tests work
// in os.tmpdir(), so register it as an allowed browse root for this process.
process.env.VK_BROWSE_ROOTS = os.tmpdir();

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {});

describe("Projects API", () => {
  const uniqueSuffix = Date.now();
  let createdProjectId: string;

  test("POST /api/projects — create a project", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `Test Project ${uniqueSuffix}`,
        path: `/tmp/test-project-${uniqueSuffix}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe(`Test Project ${uniqueSuffix}`);
    expect(body.path).toBe(`/tmp/test-project-${uniqueSuffix}`);
    expect(body.techStack).toBeInstanceOf(Array);
    expect(body.createdAt).toBeDefined();
    expect(body.updatedAt).toBeDefined();

    createdProjectId = body.id;
  });

  test("GET /api/projects — list projects includes created project", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);

    const found = body.find((p: any) => p.id === createdProjectId);
    expect(found).toBeDefined();
    expect(found.name).toBe(`Test Project ${uniqueSuffix}`);
  });

  test("GET /api/projects/:id — get single project by ID", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${createdProjectId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(createdProjectId);
    expect(body.name).toBe(`Test Project ${uniqueSuffix}`);
    expect(body.path).toBe(`/tmp/test-project-${uniqueSuffix}`);
  });

  test("GET /api/projects/:id — returns 404 for non-existent project", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/non-existent-id-12345",
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Project not found");
  });

  test("PATCH /api/projects/:id — update project name", async () => {
    const updatedName = `Updated Project ${uniqueSuffix}`;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${createdProjectId}`,
      headers: { "Content-Type": "application/json" },
      payload: { name: updatedName },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(createdProjectId);
    expect(body.name).toBe(updatedName);
  });

  test("PATCH /api/projects/:id — update favorite and category", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${createdProjectId}`,
      headers: { "Content-Type": "application/json" },
      payload: { favorite: true, category: "test-category" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.favorite).toBe(true);
    expect(body.category).toBe("test-category");
  });

  test("PATCH /api/projects/:id — returns 404 for non-existent project", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/projects/non-existent-id-12345",
      headers: { "Content-Type": "application/json" },
      payload: { name: "No Such Project" },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Project not found");
  });

  test("DELETE /api/projects/:id — delete project", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${createdProjectId}`,
    });

    expect(res.statusCode).toBe(204);
  });

  test("GET /api/projects/:id — returns 404 after deletion", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${createdProjectId}`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Project not found");
  });

  test("DELETE /api/projects/:id — returns 404 for non-existent project", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/projects/non-existent-id-12345",
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Project not found");
  });
});

describe("Milestones API", () => {
  const uniqueSuffix = Date.now();
  let projectId: string;
  let milestoneId: string;

  beforeAll(async () => {
    // Create a project to use for milestone tests
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: {
        name: `Milestone Test Project ${uniqueSuffix}`,
        path: `/tmp/test-milestone-project-${uniqueSuffix}`,
      },
    });
    const body = res.json();
    projectId = body.id;
  });

  afterAll(async () => {
    // Clean up the project (cascades to milestones)
    await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}`,
    });
  });

  test("POST /api/projects/:projectId/milestones — create milestone", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/milestones`,
      headers: { "Content-Type": "application/json" },
      payload: { name: `Sprint 1 ${uniqueSuffix}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.projectId).toBe(projectId);
    expect(body.name).toBe(`Sprint 1 ${uniqueSuffix}`);
    expect(body.createdAt).toBeDefined();

    milestoneId = body.id;
  });

  test("GET /api/projects/:projectId/milestones — list milestones", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/milestones`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const found = body.find((m: any) => m.id === milestoneId);
    expect(found).toBeDefined();
    expect(found.name).toBe(`Sprint 1 ${uniqueSuffix}`);
    expect(found.projectId).toBe(projectId);
  });

  test("POST /api/projects/:projectId/milestones — create second milestone", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/milestones`,
      headers: { "Content-Type": "application/json" },
      payload: { name: `Sprint 2 ${uniqueSuffix}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe(`Sprint 2 ${uniqueSuffix}`);
    expect(body.projectId).toBe(projectId);
  });

  test("GET /api/projects/:projectId/milestones — lists multiple milestones", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/milestones`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  test("PATCH /api/milestones/:id — update milestone name", async () => {
    const updatedName = `Sprint 1 Updated ${uniqueSuffix}`;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/milestones/${milestoneId}`,
      headers: { "Content-Type": "application/json" },
      payload: { name: updatedName },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(milestoneId);
    expect(body.name).toBe(updatedName);
  });

  test("PATCH /api/milestones/:id — update milestone status", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/milestones/${milestoneId}`,
      headers: { "Content-Type": "application/json" },
      payload: { status: "closed" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(milestoneId);
    expect(body.status).toBe("closed");
  });

  test("PATCH /api/milestones/:id — update aiInstructions", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/milestones/${milestoneId}`,
      headers: { "Content-Type": "application/json" },
      payload: { aiInstructions: "Focus on performance" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.aiInstructions).toBe("Focus on performance");
  });

  test("PATCH /api/milestones/:id — returns 404 for non-existent milestone", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/milestones/non-existent-milestone-id",
      headers: { "Content-Type": "application/json" },
      payload: { name: "No Such Milestone" },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Milestone not found");
  });

  test("DELETE /api/milestones/:id — delete milestone", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/milestones/${milestoneId}`,
    });

    expect(res.statusCode).toBe(204);
  });

  test("DELETE /api/milestones/:id — returns 404 for non-existent milestone", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/milestones/${milestoneId}`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Milestone not found");
  });

  test("GET /api/projects/:projectId/milestones — deleted milestone no longer listed", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/milestones`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const found = body.find((m: any) => m.id === milestoneId);
    expect(found).toBeUndefined();
  });
});

// ─── detectTechStack ────────────────────────────────────────────────────────

describe("detectTechStack", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-detect-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("detects React and TypeScript from package.json deps", () => {
    const dir = path.join(tmpDir, "react-ts-project");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" },
        devDependencies: { typescript: "^5.0.0", vite: "^5.0.0" },
      }),
    );

    const techs = detectTechStack(dir);
    expect(techs).toContain("React");
    expect(techs).toContain("TypeScript");
    expect(techs).toContain("Vite");
    // React should appear only once even though both react and react-dom match
    expect(techs.filter((t) => t === "React").length).toBe(1);
  });

  test("detects Fastify and Tailwind from package.json", () => {
    const dir = path.join(tmpDir, "fastify-tw-project");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        dependencies: { fastify: "^5.0.0" },
        devDependencies: { tailwindcss: "^3.0.0" },
      }),
    );

    const techs = detectTechStack(dir);
    expect(techs).toContain("Fastify");
    expect(techs).toContain("Tailwind");
  });

  test("detects TypeScript from tsconfig.json without package.json", () => {
    const dir = path.join(tmpDir, "tsconfig-only");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");

    const techs = detectTechStack(dir);
    expect(techs).toContain("TypeScript");
  });

  test("detects Rust from Cargo.toml", () => {
    const dir = path.join(tmpDir, "rust-project");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "Cargo.toml"), "[package]\nname = 'hello'");

    const techs = detectTechStack(dir);
    expect(techs).toContain("Rust");
  });

  test("detects Go from go.mod", () => {
    const dir = path.join(tmpDir, "go-project");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "go.mod"), "module example.com/hello");

    const techs = detectTechStack(dir);
    expect(techs).toContain("Go");
  });

  test("detects Python from requirements.txt", () => {
    const dir = path.join(tmpDir, "py-project");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "requirements.txt"), "flask\n");

    const techs = detectTechStack(dir);
    expect(techs).toContain("Python");
  });

  test("detects Python from pyproject.toml", () => {
    const dir = path.join(tmpDir, "py-project2");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pyproject.toml"), "[tool.poetry]");

    const techs = detectTechStack(dir);
    expect(techs).toContain("Python");
  });

  test("returns empty array for empty directory", () => {
    const dir = path.join(tmpDir, "empty-project");
    fs.mkdirSync(dir, { recursive: true });

    const techs = detectTechStack(dir);
    expect(techs).toEqual([]);
  });

  test("returns empty array for non-existent directory", () => {
    const techs = detectTechStack(path.join(tmpDir, "does-not-exist"));
    expect(techs).toEqual([]);
  });

  test("deduplicates TypeScript when both package.json dep and tsconfig.json exist", () => {
    const dir = path.join(tmpDir, "dedup-ts");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ devDependencies: { typescript: "^5.0.0" } }),
    );
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");

    const techs = detectTechStack(dir);
    expect(techs.filter((t) => t === "TypeScript").length).toBe(1);
  });
});

// ─── scanDirectory ──────────────────────────────────────────────────────────

describe("scanDirectory", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-scan-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("discovers a project directory with package.json", () => {
    const projDir = path.join(tmpDir, "my-app");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(
      path.join(projDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } }),
    );

    const results = scanDirectory(tmpDir);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const found = results.find((r) => r.path === projDir);
    expect(found).toBeDefined();
    expect(found!.name).toBe("my-app");
    expect(found!.techStack).toContain("React");
  });

  test("discovers a project directory with .git folder", () => {
    const projDir = path.join(tmpDir, "git-repo");
    fs.mkdirSync(path.join(projDir, ".git"), { recursive: true });

    const results = scanDirectory(tmpDir);
    const found = results.find((r) => r.path === projDir);
    expect(found).toBeDefined();
    expect(found!.name).toBe("git-repo");
  });

  test("does not recurse into discovered project directories", () => {
    // Create a project with a nested subfolder that also has a package.json
    const parentProj = path.join(tmpDir, "parent-proj");
    fs.mkdirSync(parentProj, { recursive: true });
    fs.writeFileSync(path.join(parentProj, "package.json"), "{}");
    const nested = path.join(parentProj, "subpkg");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "package.json"), "{}");

    const results = scanDirectory(tmpDir);
    // parent-proj should be found, but not subpkg because scanning stops at project roots
    const foundParent = results.find((r) => r.path === parentProj);
    const foundNested = results.find((r) => r.path === nested);
    expect(foundParent).toBeDefined();
    expect(foundNested).toBeUndefined();
  });

  test("returns empty for empty directory", () => {
    const emptyDir = path.join(tmpDir, "empty-scan");
    fs.mkdirSync(emptyDir, { recursive: true });

    const results = scanDirectory(emptyDir);
    expect(results).toEqual([]);
  });

  test("respects maxDepth", () => {
    const deep = path.join(tmpDir, "deep", "a", "b", "c", "d");
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, "package.json"), "{}");

    // depth 0 => maxDepth 1 means only 1 level of recursion
    const shallow = scanDirectory(path.join(tmpDir, "deep"), 0, 1);
    const found = shallow.find((r) => r.path === deep);
    expect(found).toBeUndefined();
  });

  test("skips hidden directories and node_modules", () => {
    const hidden = path.join(tmpDir, ".hidden-proj");
    fs.mkdirSync(hidden, { recursive: true });
    fs.writeFileSync(path.join(hidden, "package.json"), "{}");

    const nm = path.join(tmpDir, "node_modules", "some-pkg");
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, "package.json"), "{}");

    const results = scanDirectory(tmpDir);
    expect(results.find((r) => r.path === hidden)).toBeUndefined();
    expect(results.find((r) => r.path === nm)).toBeUndefined();
  });
});

// ─── POST /api/projects/scan endpoint ───────────────────────────────────────

describe("POST /api/projects/scan", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-scan-ep-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns discovered projects from given directories", async () => {
    const projDir = path.join(tmpDir, "scan-proj");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(
      path.join(projDir, "package.json"),
      JSON.stringify({ dependencies: { vue: "^3.0.0" } }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/projects/scan",
      headers: { "Content-Type": "application/json" },
      payload: { directories: [tmpDir] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((r: any) => r.path === projDir);
    expect(found).toBeDefined();
    expect(found.name).toBe("scan-proj");
    expect(found.techStack).toContain("Vue");
  });

  test("filters out already-imported projects", async () => {
    // Create a project directory
    const projDir = path.join(tmpDir, "already-imported");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, "package.json"), "{}");

    // Import it first
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: "Already Imported", path: projDir },
    });
    expect(createRes.statusCode).toBe(200);
    const createdId = createRes.json().id;

    // Scan should not include it
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/scan",
      headers: { "Content-Type": "application/json" },
      payload: { directories: [tmpDir] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const found = body.find((r: any) => r.path === projDir);
    expect(found).toBeUndefined();

    // Cleanup
    await app.inject({ method: "DELETE", url: `/api/projects/${createdId}` });
  });

  test("handles non-existent directories gracefully", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/scan",
      headers: { "Content-Type": "application/json" },
      payload: { directories: ["/tmp/does-not-exist-vk-test-12345"] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual([]);
  });
});

// ─── GET /api/projects query filters ────────────────────────────────────────

describe("GET /api/projects — query filters", () => {
  let favProjectId: string;
  let catProjectId: string;

  beforeAll(async () => {
    // Create a favorite project
    const res1 = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: `Filter Fav Project ${Date.now()}`, path: `/tmp/filter-fav-${Date.now()}` },
    });
    favProjectId = res1.json().id;
    await app.inject({
      method: "PATCH",
      url: `/api/projects/${favProjectId}`,
      headers: { "Content-Type": "application/json" },
      payload: { favorite: true },
    });

    // Create a project with a category
    const res2 = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: `Filter Cat Project ${Date.now()}`, path: `/tmp/filter-cat-${Date.now()}` },
    });
    catProjectId = res2.json().id;
    await app.inject({
      method: "PATCH",
      url: `/api/projects/${catProjectId}`,
      headers: { "Content-Type": "application/json" },
      payload: { category: "filter-test-category" },
    });
  });

  afterAll(async () => {
    await app.inject({ method: "DELETE", url: `/api/projects/${favProjectId}` });
    await app.inject({ method: "DELETE", url: `/api/projects/${catProjectId}` });
  });

  test("?favorite=true returns only favorite projects", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects?favorite=true",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.every((p: any) => p.favorite === true)).toBe(true);
    expect(body.find((p: any) => p.id === favProjectId)).toBeDefined();
  });

  test("?favorite=false returns only non-favorite projects", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects?favorite=false",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.every((p: any) => p.favorite === false)).toBe(true);
  });

  test("?category= returns only projects with that category", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects?category=filter-test-category",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.find((p: any) => p.id === catProjectId)).toBeDefined();
    expect(body.every((p: any) => p.category === "filter-test-category")).toBe(true);
  });
});

// ─── PATCH /api/projects — edge cases ───────────────────────────────────────

describe("PATCH /api/projects — edge cases", () => {
  let projectId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: `Patch Edge Project ${Date.now()}`, path: `/tmp/patch-edge-${Date.now()}` },
    });
    projectId = res.json().id;
  });

  afterAll(async () => {
    await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  });

  test("PATCH with techStack array serializes correctly", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { "Content-Type": "application/json" },
      payload: { techStack: ["TypeScript", "React", "Vite"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.techStack).toEqual(["TypeScript", "React", "Vite"]);
  });

  test("PATCH with externalLinks array serializes correctly", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { "Content-Type": "application/json" },
      payload: { externalLinks: [{ label: "GitHub", url: "https://github.com/test" }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.externalLinks)).toBe(true);
    expect(body.externalLinks[0].label).toBe("GitHub");
  });

  test("PATCH with no recognized fields returns existing project unchanged", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { "Content-Type": "application/json" },
      payload: { unknownField: "ignored", anotherUnknown: 42 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(projectId);
  });

  test("PATCH with aiInstructions and treeDepth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { "Content-Type": "application/json" },
      payload: {
        aiInstructions: "Use TypeScript strict mode.",
        treeDepth: 4,
        aiCommitMode: "none",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.aiInstructions).toBe("Use TypeScript strict mode.");
    expect(body.treeDepth).toBe(4);
    expect(body.aiCommitMode).toBe("none");
  });
});

// ─── GET /api/browse endpoint ────────────────────────────────────────────────

describe("GET /api/browse", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-browse-"));
    // Create some subdirectories
    fs.mkdirSync(path.join(tmpDir, "proj-a"));
    fs.writeFileSync(path.join(tmpDir, "proj-a", "package.json"), "{}");
    fs.mkdirSync(path.join(tmpDir, "plain-dir"));
    fs.mkdirSync(path.join(tmpDir, ".hidden-dir"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("lists subdirectories with project detection", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/browse?dir=${encodeURIComponent(tmpDir)}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.current).toBe(tmpDir);
    expect(body.parent).toBe(path.dirname(tmpDir));
    expect(Array.isArray(body.folders)).toBe(true);

    const projA = body.folders.find((f: any) => f.name === "proj-a");
    expect(projA).toBeDefined();
    expect(projA.isProject).toBe(true);

    const plainDir = body.folders.find((f: any) => f.name === "plain-dir");
    expect(plainDir).toBeDefined();
    expect(plainDir.isProject).toBe(false);

    // Hidden directories should be filtered out
    const hidden = body.folders.find((f: any) => f.name === ".hidden-dir");
    expect(hidden).toBeUndefined();
  });

  test("returns empty folders for non-existent directory", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/browse?dir=${encodeURIComponent("/tmp/nonexistent-vk-browse-12345")}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.folders).toEqual([]);
  });
});
