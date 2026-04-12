import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

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
