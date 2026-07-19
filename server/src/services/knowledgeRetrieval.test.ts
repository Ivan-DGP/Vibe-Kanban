import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import crypto from "node:crypto";
import { getDb, _resetDb } from "../db";
import { vectorToBlob, EMBEDDING_DIM, EMBEDDING_MODEL } from "./embeddings";
import { retrieveKnowledge } from "./knowledgeRetrieval";

// Deterministic axis vectors: e(i)·e(j) = 1 iff i==j. Lets each test steer the
// vector branch independently of the lexical (FTS) branch, which keys off the
// actual chunk text seeded into artifact_embeddings (and thus knowledge_fts via
// the v39 triggers). The intersection of these two knobs is exactly what proves
// hybrid fusion changes ranking vs vector-only.
function axisVector(axis: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  v[axis] = 1;
  return v;
}
const fakeEmbed = (axis: number) => async (_t: string) => axisVector(axis);

let db: ReturnType<typeof getDb>;
const PROJECT_ID = `__test_retrieval_${crypto.randomUUID()}__`;

function seedArtifact(opts: {
  title: string;
  content: string;
  axis: number;
  updatedAt?: string;
  chunkIdx?: number;
  artifactId?: string;
}): string {
  const artifactId = opts.artifactId ?? crypto.randomUUID();
  const now = opts.updatedAt ?? new Date().toISOString();
  // Insert the artifact row once per artifactId.
  const exists = db.prepare("SELECT 1 FROM project_artifacts WHERE id = ?").get(artifactId);
  if (!exists) {
    db.prepare(
      `INSERT INTO project_artifacts (id, projectId, filename, type, description, tags, sizeBytes, mimeType, createdAt, updatedAt)
       VALUES (?, ?, ?, 'document', ?, '[]', ?, 'text/markdown', ?, ?)`,
    ).run(artifactId, PROJECT_ID, `${opts.title}.md`, opts.title, opts.content.length, now, now);
  }
  db.prepare(
    `INSERT INTO artifact_embeddings (id, artifactId, projectId, chunkIdx, content, vector, model, dim, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    artifactId,
    PROJECT_ID,
    opts.chunkIdx ?? 0,
    opts.content,
    vectorToBlob(axisVector(opts.axis)),
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    now,
  );
  return artifactId;
}

// Seed a graph node + one embedded chunk. `mirror` marks it as an artifact-mirror
// node (metadata.kind === 'artifact'), which must be excluded from retrieval even
// though its content is embedded (and thus lands in knowledge_fts via the trigger).
function seedGraphNode(opts: {
  label: string;
  content: string;
  axis: number;
  mirror?: boolean;
}): string {
  const nodeId = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata = opts.mirror ? '{"kind":"artifact"}' : "{}";
  db.prepare(
    `INSERT INTO project_graph_nodes (id, projectId, label, type, description, metadata, createdAt, updatedAt)
     VALUES (?, ?, ?, 'concept', null, ?, ?, ?)`,
  ).run(nodeId, PROJECT_ID, opts.label, metadata, now, now);
  db.prepare(
    `INSERT INTO graph_node_embeddings (id, nodeId, projectId, chunkIdx, content, vector, model, dim, sourceHash, createdAt)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    nodeId,
    PROJECT_ID,
    opts.content,
    vectorToBlob(axisVector(opts.axis)),
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    "hash",
    now,
  );
  return nodeId;
}

beforeAll(() => {
  _resetDb();
  db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
     VALUES (?, ?, ?, 0, '[]', '[]', 'stage', 3)`,
  ).run(PROJECT_ID, "Retrieval Test", `/tmp/retrieval-${PROJECT_ID}`);
});

afterEach(() => {
  delete process.env.VK_DISABLE_EMBEDDINGS;
  db.prepare("DELETE FROM artifact_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_artifacts WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM graph_node_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_graph_nodes WHERE projectId = ?").run(PROJECT_ID);
});

afterAll(() => {
  db.prepare("DELETE FROM artifact_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_artifacts WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM graph_node_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_graph_nodes WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM projects WHERE id = ?").run(PROJECT_ID);
});

describe("retrieveKnowledge — hybrid fusion", () => {
  test("exact-token match surfaces despite an orthogonal vector (the Cerebras case)", async () => {
    // 'exact' contains the literal error string but its vector is orthogonal to
    // the query (axis 5, query is axis 1). 'semantic' has NO literal token match
    // but its vector aligns with the query (axis 1). Vector-only would rank
    // 'semantic' first and never surface 'exact'. Hybrid must surface 'exact'.
    const exact = seedArtifact({
      title: "logs",
      content: "restore hangs: ENOSPC on host web-07 after manifest load",
      axis: 5,
    });
    seedArtifact({ title: "notes", content: "general infrastructure overview and tips", axis: 1 });

    const res = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "ENOSPC web-07",
      embedFn: fakeEmbed(1), // aligns with 'semantic', orthogonal to 'exact'
      types: ["artifact"],
    });

    const ids = res.hits.map((h) => h.entityId);
    // Exact-token doc is present AND ranks first (only it matches the lexical query).
    expect(ids).toContain(exact);
    expect(res.hits[0].entityId).toBe(exact);
  });

  test("pure semantic query still returns vector hits when nothing matches lexically", async () => {
    const a = seedArtifact({ title: "doc", content: "alpha beta gamma", axis: 3 });
    const res = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "zzzznomatch", // no lexical hit
      embedFn: fakeEmbed(3),
      types: ["artifact"],
    });
    expect(res.hits[0].entityId).toBe(a);
  });
});

describe("retrieveKnowledge — options", () => {
  test("kill-switch returns empty without reading rows or embedding", async () => {
    seedArtifact({ title: "doc", content: "some content here", axis: 1 });
    process.env.VK_DISABLE_EMBEDDINGS = "1";
    let embedCalled = false;
    const res = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "content",
      embedFn: async (_t) => {
        embedCalled = true;
        return axisVector(1);
      },
    });
    expect(res.hits).toEqual([]);
    expect(res.totalCandidates).toBe(0);
    expect(embedCalled).toBe(false);
  });

  test("empty/whitespace query returns empty", async () => {
    seedArtifact({ title: "doc", content: "some content here", axis: 1 });
    const res = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "   ",
      embedFn: fakeEmbed(1),
    });
    expect(res.hits).toEqual([]);
  });

  test("minScore floors on the fused score", async () => {
    seedArtifact({ title: "doc", content: "alpha", axis: 1 });
    const res = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "alpha",
      embedFn: fakeEmbed(1),
      minScore: 1, // fused RRF scores are ~0.03, so everything is filtered out
    });
    expect(res.hits).toEqual([]);
    expect(res.totalCandidates).toBe(1); // candidates still counted
  });

  test("perEntityCap limits chunks per entity", async () => {
    const id = crypto.randomUUID();
    // Same artifact, three chunks, all lexically matching 'shard'.
    seedArtifact({
      artifactId: id,
      title: "big",
      content: "shard one detail",
      axis: 1,
      chunkIdx: 0,
    });
    seedArtifact({
      artifactId: id,
      title: "big",
      content: "shard two detail",
      axis: 2,
      chunkIdx: 1,
    });
    seedArtifact({
      artifactId: id,
      title: "big",
      content: "shard three detail",
      axis: 3,
      chunkIdx: 2,
    });

    const capped = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "shard",
      embedFn: fakeEmbed(1),
      types: ["artifact"],
      perEntityCap: 1,
    });
    expect(capped.hits.length).toBe(1);

    const uncapped = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "shard",
      embedFn: fakeEmbed(1),
      types: ["artifact"],
    });
    expect(uncapped.hits.length).toBe(3);
  });

  test("recency decay reorders near-tied hits toward fresher content", async () => {
    const now = Date.parse("2026-07-19T00:00:00.000Z");
    // Two docs that tie lexically ('release') but differ only in age. Give them
    // DIFFERENT vector axes both orthogonal to the query so cosine is 0 for both
    // → fused scores are driven purely by the (identical) lexical rank, and decay
    // is the tie-breaker.
    const fresh = seedArtifact({
      title: "fresh",
      content: "release checklist",
      axis: 7,
      updatedAt: "2026-07-18T00:00:00.000Z", // 1 day old
    });
    const stale = seedArtifact({
      title: "stale",
      content: "release checklist",
      axis: 8,
      updatedAt: "2026-01-01T00:00:00.000Z", // ~199 days old
    });

    const withDecay = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "release",
      embedFn: fakeEmbed(1), // orthogonal to both (axes 7,8)
      types: ["artifact"],
      recencyHalfLifeDays: 30,
      nowMs: now,
    });
    expect(withDecay.hits[0].entityId).toBe(fresh);
    expect(withDecay.hits.map((h) => h.entityId)).toContain(stale);
  });

  test("expandNeighbors attaches adjacent chunk text", async () => {
    const id = crypto.randomUUID();
    seedArtifact({ artifactId: id, title: "seq", content: "prologue text", axis: 1, chunkIdx: 0 });
    seedArtifact({
      artifactId: id,
      title: "seq",
      content: "middle needle text",
      axis: 2,
      chunkIdx: 1,
    });
    seedArtifact({ artifactId: id, title: "seq", content: "epilogue text", axis: 3, chunkIdx: 2 });

    const res = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "needle",
      embedFn: fakeEmbed(2),
      types: ["artifact"],
      expandNeighbors: true,
    });
    const hit = res.hits.find((h) => h.chunkIdx === 1)!;
    expect(hit.neighborContext).toContain("prologue text");
    expect(hit.neighborContext).toContain("epilogue text");
  });

  test("graph-node branch works and mirror nodes are excluded from BOTH branches", async () => {
    // A real concept node and a mirror node share the lexical token 'widget' and
    // the SAME query-aligned vector axis (1). Vector-only would rank the mirror
    // node too; lexical would match it too. Neither branch may surface it.
    const real = seedGraphNode({ label: "Widget System", content: "widget subsystem", axis: 1 });
    seedGraphNode({ label: "widget.md", content: "widget subsystem", axis: 1, mirror: true });

    const res = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "widget",
      embedFn: fakeEmbed(1),
      types: ["graph_node"],
    });
    const ids = res.hits.map((h) => h.entityId);
    expect(ids).toContain(real);
    expect(res.hits.length).toBe(1); // only the real node; mirror excluded
    expect(res.hits[0].graphNode?.label).toBe("Widget System");
    expect(res.totalCandidates).toBe(1); // mirror never entered the candidate set
  });

  test("coerces string k/minScore and never lets garbage disable the cap/filter", async () => {
    // Three matching artifacts. Body values can arrive as strings over HTTP.
    seedArtifact({ title: "d1", content: "coerce token one", axis: 1 });
    seedArtifact({ title: "d2", content: "coerce token two", axis: 2 });
    seedArtifact({ title: "d3", content: "coerce token three", axis: 3 });

    // Numeric-string k is honored as a real page size.
    const kStr = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "coerce",
      embedFn: fakeEmbed(1),
      types: ["artifact"],
      k: "2" as unknown as number,
    });
    expect(kStr.hits.length).toBe(2);

    // Garbage k must NOT become NaN and bypass the cap — falls back to default 10.
    const kGarbage = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "coerce",
      embedFn: fakeEmbed(1),
      types: ["artifact"],
      k: "abc" as unknown as number,
    });
    expect(kGarbage.hits.length).toBe(3); // all 3 (< default 10), not a NaN-broken cap

    // Numeric-string minScore is honored (here it filters everything out).
    const msStr = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "coerce",
      embedFn: fakeEmbed(1),
      types: ["artifact"],
      minScore: "1" as unknown as number,
    });
    expect(msStr.hits.length).toBe(0);
  });

  test("empty corpus returns empty, never throws", async () => {
    const res = await retrieveKnowledge({
      projectId: PROJECT_ID,
      query: "anything",
      embedFn: fakeEmbed(1),
    });
    expect(res).toEqual({ model: EMBEDDING_MODEL, hits: [], totalCandidates: 0 });
  });
});
