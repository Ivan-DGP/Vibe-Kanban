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

describe("Graph status + confirm", () => {
  let pid: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: `Status Test ${Date.now()}`, path: `/tmp/status-test-${Date.now()}` },
    });
    pid = res.json().id;
  });

  afterAll(async () => {
    if (pid) await app.inject({ method: "DELETE", url: `/api/projects/${pid}` });
  });

  test("created node defaults to status 'confirmed' with null origin", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${pid}/graph/nodes`,
      headers: { "Content-Type": "application/json" },
      payload: { label: "Default Node" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("confirmed");
    expect(res.json().origin).toBeNull();
  });

  test("confirm node sets status 'confirmed'", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/api/projects/${pid}/graph/nodes`,
      headers: { "Content-Type": "application/json" },
      payload: { label: "Confirm Me" },
    });
    const nodeId = create.json().id;
    const res = await app.inject({
      method: "POST",
      url: `/api/graph/nodes/${nodeId}/confirm`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("confirmed");
  });

  test("confirm node — 404 for missing", async () => {
    const res = await app.inject({ method: "POST", url: "/api/graph/nodes/nope/confirm" });
    expect(res.statusCode).toBe(404);
  });

  test("confirm edge — 404 for missing", async () => {
    const res = await app.inject({ method: "POST", url: "/api/graph/edges/nope/confirm" });
    expect(res.statusCode).toBe(404);
  });

  test("bulk confirm returns counts scoped to project", async () => {
    const a = await app.inject({
      method: "POST",
      url: `/api/projects/${pid}/graph/nodes`,
      headers: { "Content-Type": "application/json" },
      payload: { label: "Bulk A" },
    });
    const b = await app.inject({
      method: "POST",
      url: `/api/projects/${pid}/graph/nodes`,
      headers: { "Content-Type": "application/json" },
      payload: { label: "Bulk B" },
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${pid}/graph/confirm`,
      headers: { "Content-Type": "application/json" },
      payload: { nodeIds: [a.json().id, b.json().id, "missing"], edgeIds: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().nodesConfirmed).toBe(2);
    expect(res.json().edgesConfirmed).toBe(0);
  });
});

describe("Graph write API (upsert + batch)", () => {
  let pid: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { "Content-Type": "application/json" },
      payload: { name: `Write Test ${Date.now()}`, path: `/tmp/write-test-${Date.now()}` },
    });
    pid = res.json().id;
  });

  afterAll(async () => {
    if (pid) await app.inject({ method: "DELETE", url: `/api/projects/${pid}` });
  });

  const createNode = (payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `/api/projects/${pid}/graph/nodes`,
      headers: { "Content-Type": "application/json" },
      payload,
    });

  test("node create is idempotent on (slug(label), type)", async () => {
    const first = await createNode({ label: "Repeat Concept", type: "concept" });
    const second = await createNode({ label: "repeat concept", type: "concept" }); // same slug
    expect(second.json().id).toBe(first.json().id);

    const graph = await app.inject({ method: "GET", url: `/api/projects/${pid}/graph` });
    const matches = graph.json().nodes.filter((n: { label: string }) => /repeat concept/i.test(n.label));
    expect(matches.length).toBe(1);
  });

  test("different type with same label is a distinct node", async () => {
    const a = await createNode({ label: "Polymorph", type: "concept" });
    const b = await createNode({ label: "Polymorph", type: "system" });
    expect(b.json().id).not.toBe(a.json().id);
  });

  test("create accepts status + origin", async () => {
    const res = await createNode({
      label: "Suggested Node",
      status: "suggested",
      origin: "brain:capture",
    });
    expect(res.json().status).toBe("suggested");
    expect(res.json().origin).toBe("brain:capture");
  });

  test("batch auto-creates missing edge endpoints as suggested + dedupes", async () => {
    const batch = {
      nodes: [{ label: "Alpha", type: "concept" }],
      edges: [{ source: "Alpha", target: "Beta", type: "related", origin: "brain:capture" }],
    };
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${pid}/graph/batch`,
      headers: { "Content-Type": "application/json" },
      payload: batch,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Alpha + auto-created Beta
    expect(body.nodesCreated).toBe(2);
    expect(body.edgesCreated).toBe(1);
    const beta = body.nodes.find((n: { label: string }) => n.label === "Beta");
    expect(beta.status).toBe("suggested");
    expect(body.edges[0].status).toBe("suggested");

    // Re-running the identical batch is a no-op (nodes deduped, edge deduped).
    const again = await app.inject({
      method: "POST",
      url: `/api/projects/${pid}/graph/batch`,
      headers: { "Content-Type": "application/json" },
      payload: batch,
    });
    expect(again.json().nodesCreated).toBe(0);
    expect(again.json().edgesCreated).toBe(0);
  });

  test("suggested node from batch can be confirmed", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${pid}/graph/batch`,
      headers: { "Content-Type": "application/json" },
      payload: { nodes: [{ label: "Gamma" }], edges: [] },
    });
    const gamma = res.json().nodes.find((n: { label: string }) => n.label === "Gamma");
    expect(gamma.status).toBe("suggested");

    const confirm = await app.inject({
      method: "POST",
      url: `/api/graph/nodes/${gamma.id}/confirm`,
    });
    expect(confirm.json().status).toBe("confirmed");
  });
});
