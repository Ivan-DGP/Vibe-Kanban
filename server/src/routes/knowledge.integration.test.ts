import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import crypto from "node:crypto";
import { getDb } from "../db";
import { vectorToBlob, EMBEDDING_DIM, EMBEDDING_MODEL } from "../services/embeddings";

// Deterministic axis vectors: e(i)·e(j) = 1 iff i==j, else 0. This gives total
// control over ranking without loading the transformer model.
function axisVector(axis: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  v[axis] = 1;
  return v;
}

// The query embedding the route will receive. Tests set this before calling so
// they can steer which seeded artifact ranks first.
let queryAxis = 0;
let embedCalled = false;

// Stub embed() so the search route never loads the model. The kill-switch path
// must short-circuit BEFORE this is reached; embedCalled lets us assert that.
mock.module("../services/embeddings", () => {
  const real = require("../services/embeddings");
  return {
    ...real,
    embed: async (_text: string): Promise<Float32Array> => {
      embedCalled = true;
      return axisVector(queryAxis);
    },
  };
});

// Import buildApp AFTER the mock is registered so the lazily-loaded knowledge
// route binds to the stubbed embed.
const { buildApp } = await import("../app");

let app: Awaited<ReturnType<typeof buildApp>>;
let db: ReturnType<typeof getDb>;
const PROJECT_ID = `__test_knowledge_integration_${crypto.randomUUID()}__`;

function seedArtifact(opts: { title: string; content: string; axis: number }): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_artifacts (id, projectId, filename, type, description, tags, sizeBytes, mimeType, createdAt, updatedAt)
     VALUES (?, ?, ?, 'document', ?, '[]', ?, 'text/markdown', ?, ?)`,
  ).run(id, PROJECT_ID, `${opts.title}.md`, opts.title, opts.content.length, now, now);
  db.prepare(
    `INSERT INTO artifact_embeddings (id, artifactId, projectId, chunkIdx, content, vector, model, dim, createdAt)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    id,
    PROJECT_ID,
    opts.content,
    vectorToBlob(axisVector(opts.axis)),
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    now,
  );
  return id;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
     VALUES (?, ?, ?, 0, '[]', '[]', 'stage', 3)`,
  ).run(PROJECT_ID, "Knowledge Integration Test", `/tmp/knowledge-integration-${PROJECT_ID}`);
});

afterEach(() => {
  delete process.env.VK_DISABLE_EMBEDDINGS;
  embedCalled = false;
  queryAxis = 0;
  db.prepare("DELETE FROM artifact_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_artifacts WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM graph_node_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_graph_nodes WHERE projectId = ?").run(PROJECT_ID);
});

afterAll(async () => {
  db.prepare("DELETE FROM artifact_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_artifacts WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM graph_node_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_graph_nodes WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM projects WHERE id = ?").run(PROJECT_ID);
  await app.close();
});

// Seed a graph node plus one embedding chunk. `mirror: true` marks it as an
// artifact-mirror node (metadata.kind === 'artifact'), which must be excluded
// from indexing/stats/search.
function seedGraphNode(opts: { label: string; axis: number; mirror: boolean }): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata = opts.mirror
    ? JSON.stringify({ kind: "artifact", artifactId: crypto.randomUUID(), slug: opts.label })
    : JSON.stringify({});
  db.prepare(
    `INSERT INTO project_graph_nodes (id, projectId, label, type, description, x, y, metadata, status, origin, createdAt, updatedAt)
     VALUES (?, ?, ?, 'concept', NULL, NULL, NULL, ?, 'confirmed', NULL, ?, ?)`,
  ).run(id, PROJECT_ID, opts.label, metadata, now, now);
  db.prepare(
    `INSERT INTO graph_node_embeddings (id, nodeId, projectId, chunkIdx, content, vector, model, dim, sourceHash, createdAt)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'testhash', ?)`,
  ).run(
    crypto.randomUUID(),
    id,
    PROJECT_ID,
    opts.label,
    vectorToBlob(axisVector(opts.axis)),
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    now,
  );
  return id;
}

describe("POST /api/projects/:id/knowledge/search", () => {
  test("returns results sorted by score desc with the documented shape", async () => {
    seedArtifact({ title: "Auth Service", content: "OAuth login flow", axis: 0 });
    seedArtifact({ title: "Billing", content: "Stripe invoice reconciliation", axis: 1 });
    seedArtifact({ title: "Maps", content: "Leaflet tiles", axis: 2 });

    // Query aligns with axis 0 → Auth scores 1, others 0.
    queryAxis = 0;
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${PROJECT_ID}/knowledge/search`,
      headers: { "Content-Type": "application/json" },
      payload: { query: "how does login work" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Documented shape.
    expect(body).toHaveProperty("query", "how does login work");
    expect(body).toHaveProperty("model", EMBEDDING_MODEL);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body).toHaveProperty("totalChunks", 3);

    // Sorted by score desc.
    const scores = body.results.map((r: { score: number }) => r.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
    // Top hit is the axis-0 (Auth) artifact.
    expect(body.results[0].artifact.filename).toBe("Auth Service.md");
    // Score is now the fused RRF score (hybrid vector+lexical), not raw cosine,
    // so it is a small positive value rather than ~1.0. Ranking is what matters.
    expect(body.results[0].score).toBeGreaterThan(0);
  });

  test("excludes artifact-mirror nodes from graph-node search results", async () => {
    // Real node and mirror node share the query axis → both would score 1 if
    // included. Only the real node must come back.
    seedGraphNode({ label: "Real Concept", axis: 0, mirror: false });
    seedGraphNode({ label: "mirror-of-artifact.md", axis: 0, mirror: true });

    queryAxis = 0;
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${PROJECT_ID}/knowledge/search`,
      headers: { "Content-Type": "application/json" },
      payload: { query: "concept", types: ["graph_node"] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalChunks).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].graphNode.label).toBe("Real Concept");
  });

  test("returns 400 on empty query", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${PROJECT_ID}/knowledge/search`,
      headers: { "Content-Type": "application/json" },
      payload: { query: "   " },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });

  test("returns 400 when query is missing entirely", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${PROJECT_ID}/knowledge/search`,
      headers: { "Content-Type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  test("kill-switch: VK_DISABLE_EMBEDDINGS=1 returns empty WITHOUT loading the model", async () => {
    seedArtifact({ title: "Auth Service", content: "OAuth login flow", axis: 0 });
    process.env.VK_DISABLE_EMBEDDINGS = "1";

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${PROJECT_ID}/knowledge/search`,
      headers: { "Content-Type": "application/json" },
      payload: { query: "how does login work" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toEqual([]);
    expect(body.totalChunks).toBe(0);
    expect(body.model).toBe(EMBEDDING_MODEL);
    // The model/embed path was never reached.
    expect(embedCalled).toBe(false);
  });
});

describe("GET /api/projects/:id/knowledge/stats", () => {
  test("returns per-kind count fields", async () => {
    // 2 artifacts (1 chunk each) embedded; tasks/graph nodes left at 0.
    seedArtifact({ title: "Doc A", content: "alpha", axis: 0 });
    seedArtifact({ title: "Doc B", content: "beta", axis: 1 });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${PROJECT_ID}/knowledge/stats`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Artifact counters.
    expect(body.artifactCount).toBe(2);
    expect(body.embeddedArtifacts).toBe(2);
    expect(body.chunkCount).toBe(2);
    expect(body.pending).toBe(0);

    // Task counters present (no tasks seeded → 0).
    expect(body).toHaveProperty("taskCount");
    expect(body).toHaveProperty("embeddedTasks", 0);
    expect(body).toHaveProperty("taskChunkCount", 0);
    expect(body).toHaveProperty("pendingTasks");

    // Graph-node counters present.
    expect(body).toHaveProperty("graphNodeCount", 0);
    expect(body).toHaveProperty("embeddedGraphNodes", 0);
    expect(body).toHaveProperty("graphNodeChunkCount", 0);
    expect(body).toHaveProperty("pendingGraphNodes", 0);

    expect(body.model).toBe(EMBEDDING_MODEL);
  });

  test("excludes artifact-mirror nodes from graph-node counts", async () => {
    // One real graph node + one artifact-mirror node, both with an embedding.
    // Only the real node should be counted.
    seedGraphNode({ label: "Real Concept", axis: 0, mirror: false });
    seedGraphNode({ label: "mirror-of-artifact.md", axis: 1, mirror: true });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${PROJECT_ID}/knowledge/stats`,
    });
    const body = res.json();
    expect(body.graphNodeCount).toBe(1);
    expect(body.embeddedGraphNodes).toBe(1);
    expect(body.graphNodeChunkCount).toBe(1);
    expect(body.pendingGraphNodes).toBe(0);
  });

  test("pending reflects unembedded artifacts", async () => {
    // Insert an artifact row WITHOUT embeddings.
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO project_artifacts (id, projectId, filename, type, description, tags, sizeBytes, mimeType, createdAt, updatedAt)
       VALUES (?, ?, 'unembedded.md', 'document', NULL, '[]', 5, 'text/markdown', ?, ?)`,
    ).run(crypto.randomUUID(), PROJECT_ID, now, now);

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${PROJECT_ID}/knowledge/stats`,
    });
    const body = res.json();
    expect(body.artifactCount).toBe(1);
    expect(body.embeddedArtifacts).toBe(0);
    expect(body.pending).toBe(1);
  });
});
