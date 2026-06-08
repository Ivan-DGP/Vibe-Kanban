import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import crypto from "node:crypto";
import { EMBEDDING_DIM } from "./embeddings";

// Replace the real model with a deterministic fake so the embedder runs without
// loading transformers. Each call returns a unit vector on a rotating axis;
// values are irrelevant to these tests, only the row bookkeeping matters.
let embedCalls = 0;
mock.module("./embeddings", () => {
  const real = require("./embeddings");
  return {
    ...real,
    embed: async (_text: string): Promise<Float32Array> => {
      const v = new Float32Array(EMBEDDING_DIM);
      v[embedCalls % EMBEDDING_DIM] = 1;
      embedCalls++;
      return v;
    },
  };
});

import { getDb } from "../db";
import { embedArtifact, clearArtifactEmbeddings } from "./artifactEmbedder";

const PROJECT_ID = `__test_artifact_embedder_${crypto.randomUUID()}__`;
let db: ReturnType<typeof getDb>;

function rowCount(artifactId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) as n FROM artifact_embeddings WHERE artifactId = ?")
      .get(artifactId) as { n: number }
  ).n;
}

// artifact_embeddings.artifactId is a FK to project_artifacts.id — seed the
// parent row before embedding so inserts don't violate the constraint.
function seedArtifactRow(artifactId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_artifacts (id, projectId, filename, type, description, tags, sizeBytes, mimeType, createdAt, updatedAt)
     VALUES (?, ?, ?, 'document', NULL, '[]', 0, 'text/markdown', ?, ?)`,
  ).run(artifactId, PROJECT_ID, `${artifactId}.md`, now, now);
}

beforeAll(() => {
  db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
     VALUES (?, ?, ?, 0, '[]', '[]', 'stage', 3)`,
  ).run(PROJECT_ID, "Artifact Embedder Test", `/tmp/artifact-embedder-${PROJECT_ID}`);
});

afterEach(() => {
  delete process.env.VK_DISABLE_EMBEDDINGS;
  embedCalls = 0;
  db.prepare("DELETE FROM artifact_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_artifacts WHERE projectId = ?").run(PROJECT_ID);
});

afterAll(() => {
  db.prepare("DELETE FROM artifact_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_artifacts WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM projects WHERE id = ?").run(PROJECT_ID);
});

describe("embedArtifact", () => {
  test("writes one embedding row per chunk", async () => {
    const artifactId = crypto.randomUUID();
    seedArtifactRow(artifactId);
    // ~6000 chars, no blank lines => one paragraph split into 3 chunks of <=2000.
    const content = "x".repeat(6000);

    const n = await embedArtifact({
      projectId: PROJECT_ID,
      artifactId,
      content,
      mimeType: "text/markdown",
    });

    expect(n).toBe(3);
    expect(rowCount(artifactId)).toBe(3);

    // chunkIdx is 0..n-1, contiguous
    const idxs = (
      db
        .prepare("SELECT chunkIdx FROM artifact_embeddings WHERE artifactId = ? ORDER BY chunkIdx")
        .all(artifactId) as { chunkIdx: number }[]
    ).map((r) => r.chunkIdx);
    expect(idxs).toEqual([0, 1, 2]);
  });

  test("clears prior rows on re-embed (no accumulation)", async () => {
    const artifactId = crypto.randomUUID();
    seedArtifactRow(artifactId);

    await embedArtifact({
      projectId: PROJECT_ID,
      artifactId,
      content: "x".repeat(6000), // 3 chunks
      mimeType: "text/markdown",
    });
    expect(rowCount(artifactId)).toBe(3);

    // Re-embed with smaller content => fewer chunks, prior rows must be gone.
    const n = await embedArtifact({
      projectId: PROJECT_ID,
      artifactId,
      content: "small but long enough to pass the min chunk size threshold",
      mimeType: "text/markdown",
    });
    expect(n).toBe(1);
    expect(rowCount(artifactId)).toBe(1);
  });

  test("skips non-embeddable mime types (returns 0, writes nothing)", async () => {
    const artifactId = crypto.randomUUID();
    seedArtifactRow(artifactId);
    const before = embedCalls;

    const n = await embedArtifact({
      projectId: PROJECT_ID,
      artifactId,
      content: "binary-ish content".repeat(100),
      mimeType: "image/png",
    });

    expect(n).toBe(0);
    expect(rowCount(artifactId)).toBe(0);
    // embed() never invoked for a skipped mime type.
    expect(embedCalls).toBe(before);
  });

  test("empty content clears existing rows and returns 0", async () => {
    const artifactId = crypto.randomUUID();
    seedArtifactRow(artifactId);
    await embedArtifact({
      projectId: PROJECT_ID,
      artifactId,
      content: "x".repeat(6000),
      mimeType: "text/markdown",
    });
    expect(rowCount(artifactId)).toBe(3);

    const n = await embedArtifact({
      projectId: PROJECT_ID,
      artifactId,
      content: "   ",
      mimeType: "text/markdown",
    });
    expect(n).toBe(0);
    expect(rowCount(artifactId)).toBe(0);
  });

  test("kill-switch: VK_DISABLE_EMBEDDINGS=1 is a no-op (no model load, no rows)", async () => {
    process.env.VK_DISABLE_EMBEDDINGS = "1";
    const artifactId = crypto.randomUUID();
    seedArtifactRow(artifactId);
    const before = embedCalls;

    const n = await embedArtifact({
      projectId: PROJECT_ID,
      artifactId,
      content: "x".repeat(6000),
      mimeType: "text/markdown",
    });

    expect(n).toBe(0);
    expect(rowCount(artifactId)).toBe(0);
    // embed() must NOT have been called under the switch.
    expect(embedCalls).toBe(before);
  });
});

describe("clearArtifactEmbeddings", () => {
  test("removes all rows for an artifact", async () => {
    const artifactId = crypto.randomUUID();
    seedArtifactRow(artifactId);
    await embedArtifact({
      projectId: PROJECT_ID,
      artifactId,
      content: "x".repeat(6000),
      mimeType: "text/markdown",
    });
    expect(rowCount(artifactId)).toBe(3);

    clearArtifactEmbeddings(artifactId);
    expect(rowCount(artifactId)).toBe(0);
  });
});
