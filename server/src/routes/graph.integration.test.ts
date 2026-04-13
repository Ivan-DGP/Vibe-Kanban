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
    payload: { name: `Graph Test ${Date.now()}`, path: `/tmp/graph-test-${Date.now()}` },
  });
  projectId = res.json().id;
});

afterAll(async () => {
  if (projectId) {
    await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  }
});

describe("Knowledge Graph API", () => {
  let nodeAId: string;
  let nodeBId: string;
  let edgeId: string;

  test("POST /api/projects/:id/graph/nodes — create node", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/graph/nodes`,
      headers: { "Content-Type": "application/json" },
      payload: {
        label: "Auth System",
        type: "system",
        description: "Authentication and authorization",
        x: 100,
        y: 200,
        metadata: { criticality: "high" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.label).toBe("Auth System");
    expect(body.type).toBe("system");
    expect(body.x).toBe(100);
    expect(body.y).toBe(200);
    expect(body.metadata).toEqual({ criticality: "high" });
    nodeAId = body.id;
  });

  test("POST — create second node", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/graph/nodes`,
      headers: { "Content-Type": "application/json" },
      payload: { label: "Database", type: "technology" },
    });

    expect(res.statusCode).toBe(200);
    nodeBId = res.json().id;
  });

  test("GET /api/projects/:id/graph — returns nodes and edges", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/graph`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nodes).toBeInstanceOf(Array);
    expect(body.edges).toBeInstanceOf(Array);
    expect(body.nodes.length).toBe(2);
    expect(body.nodes[0].label).toBe("Auth System");
  });

  test("PATCH /graph/nodes/:id — update node", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/graph/nodes/${nodeAId}`,
      headers: { "Content-Type": "application/json" },
      payload: { label: "Auth Service", x: 150, y: 250 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.label).toBe("Auth Service");
    expect(body.x).toBe(150);
  });

  test("PATCH — 404 for non-existent node", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/graph/nodes/nonexistent",
      headers: { "Content-Type": "application/json" },
      payload: { label: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });

  test("POST /api/projects/:id/graph/edges — create edge", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/graph/edges`,
      headers: { "Content-Type": "application/json" },
      payload: {
        sourceNodeId: nodeAId,
        targetNodeId: nodeBId,
        label: "uses",
        type: "depends_on",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.sourceNodeId).toBe(nodeAId);
    expect(body.targetNodeId).toBe(nodeBId);
    expect(body.label).toBe("uses");
    expect(body.type).toBe("depends_on");
    edgeId = body.id;
  });

  test("POST edge — requires both node IDs", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/graph/edges`,
      headers: { "Content-Type": "application/json" },
      payload: { sourceNodeId: nodeAId },
    });
    expect(res.statusCode).toBe(400);
  });

  test("POST edge — rejects invalid node IDs", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/graph/edges`,
      headers: { "Content-Type": "application/json" },
      payload: { sourceNodeId: nodeAId, targetNodeId: "nonexistent" },
    });
    expect(res.statusCode).toBe(400);
  });

  test("GET graph — includes edges after creation", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/graph`,
    });
    expect(res.json().edges.length).toBe(1);
    expect(res.json().edges[0].sourceNodeId).toBe(nodeAId);
  });

  test("DELETE /graph/edges/:id — delete edge", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/graph/edges/${edgeId}`,
    });
    expect(res.statusCode).toBe(204);

    // Verify edge gone
    const graphRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/graph`,
    });
    expect(graphRes.json().edges.length).toBe(0);
  });

  test("DELETE edge — 404 for non-existent", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/graph/edges/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  test("DELETE /graph/nodes/:id — cascades to edges", async () => {
    // Re-create an edge first
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/graph/edges`,
      headers: { "Content-Type": "application/json" },
      payload: { sourceNodeId: nodeAId, targetNodeId: nodeBId, type: "related" },
    });

    // Delete node A — edge should cascade delete
    const res = await app.inject({
      method: "DELETE",
      url: `/api/graph/nodes/${nodeAId}`,
    });
    expect(res.statusCode).toBe(204);

    const graphRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/graph`,
    });
    expect(graphRes.json().nodes.length).toBe(1);
    expect(graphRes.json().edges.length).toBe(0);
  });

  test("DELETE node — 404 for non-existent", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/graph/nodes/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  test("graph cascade deletes with project", async () => {
    const projRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: `Cascade Graph ${Date.now()}`, path: `/tmp/cascade-graph-${Date.now()}` },
    });
    const tempId = projRes.json().id;

    await app.inject({
      method: "POST",
      url: `/api/projects/${tempId}/graph/nodes`,
      headers: { "Content-Type": "application/json" },
      payload: { label: "Temp Node" },
    });

    await app.inject({ method: "DELETE", url: `/api/projects/${tempId}` });

    const graphRes = await app.inject({
      method: "GET",
      url: `/api/projects/${tempId}/graph`,
    });
    expect(graphRes.json().nodes.length).toBe(0);
  });
});
