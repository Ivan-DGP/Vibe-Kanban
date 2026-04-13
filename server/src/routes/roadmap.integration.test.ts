import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";

let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { "Content-Type": "application/json" },
    payload: { name: `Roadmap Test ${Date.now()}`, path: `/tmp/roadmap-test-${Date.now()}` },
  });
  projectId = res.json().id;
});

afterAll(async () => {
  if (projectId) {
    await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  }
});

describe("Roadmap API", () => {
  let itemId: string;

  test("POST /api/projects/:id/roadmap — create item", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: {
        title: "Phase 1: MVP",
        description: "Build the minimum viable product",
        status: "planned",
        startDate: "2026-04-15",
        endDate: "2026-05-15",
        color: "#3b82f6",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe("Phase 1: MVP");
    expect(body.status).toBe("planned");
    expect(body.startDate).toBe("2026-04-15");
    expect(body.endDate).toBe("2026-05-15");
    expect(body.dependsOn).toEqual([]);
    expect(body.sortOrder).toBeGreaterThan(0);
    itemId = body.id;
  });

  test("POST — create with dependencies", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: {
        title: "Phase 2: Beta",
        status: "planned",
        dependsOn: [itemId],
        startDate: "2026-05-16",
        endDate: "2026-06-15",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().dependsOn).toEqual([itemId]);
  });

  test("GET /api/projects/:id/roadmap — list items", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/roadmap`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toBeInstanceOf(Array);
    expect(body.length).toBe(2);
    expect(body[0].title).toBe("Phase 1: MVP");
  });

  test("PATCH /roadmap/:id — update item", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/roadmap/${itemId}`,
      headers: { "Content-Type": "application/json" },
      payload: {
        title: "Phase 1: Core MVP",
        status: "in_progress",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("Phase 1: Core MVP");
    expect(body.status).toBe("in_progress");
  });

  test("PATCH — 404 for non-existent item", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/roadmap/nonexistent",
      headers: { "Content-Type": "application/json" },
      payload: { title: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });

  test("DELETE /roadmap/:id — delete item", async () => {
    // Create then delete
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "To Delete" },
    });
    const delId = createRes.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/roadmap/${delId}`,
    });
    expect(res.statusCode).toBe(204);

    // Verify list doesn't include it
    const listRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/roadmap`,
    });
    const ids = listRes.json().map((i: any) => i.id);
    expect(ids).not.toContain(delId);
  });

  test("DELETE — 404 for non-existent item", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/roadmap/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  test("items cascade delete with project", async () => {
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: `Cascade Roadmap ${Date.now()}`, path: `/tmp/cascade-roadmap-${Date.now()}` },
    });
    const tempId = projRes.json().id;

    await app.inject({
      method: "POST",
      url: `/api/projects/${tempId}/roadmap`,
      headers: { "Content-Type": "application/json" },
      payload: { title: "Temp Phase" },
    });

    await app.inject({ method: "DELETE", url: `/api/projects/${tempId}` });

    const listRes = await app.inject({
      method: "GET",
      url: `/api/projects/${tempId}/roadmap`,
    });
    expect(listRes.json().length).toBe(0);
  });
});
