import { describe, test, expect, beforeAll, afterEach, afterAll } from "bun:test";
import crypto from "node:crypto";
import { getDb } from "../db";
import { vectorToBlob, EMBEDDING_DIM, EMBEDDING_MODEL } from "./embeddings";
import { searchMemory, type EmbedFn } from "./memorySearch";
import type { MemoryType } from "@vibe-kanban/shared";

function axisVector(axis: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  v[axis] = 1;
  return v;
}
const fakeEmbed =
  (axis: number): EmbedFn =>
  async (_t: string) =>
    axisVector(axis);

const PROJECT_A = `__mem_search_a_${crypto.randomUUID()}__`;
const PROJECT_B = `__mem_search_b_${crypto.randomUUID()}__`;

function seedMemory(opts: {
  projectId: string;
  type: MemoryType;
  title: string;
  body: string;
  axis: number;
  supersededById?: string;
  chunks?: { content: string; axis: number }[];
}): string {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_memory (id, projectId, type, title, body, files, origin, supersededBy, createdAt)
     VALUES (?, ?, ?, ?, ?, '["a.ts"]', 'ai_captured', ?, ?)`,
  ).run(id, opts.projectId, opts.type, opts.title, opts.body, opts.supersededById ?? null, now);
  const chunks = opts.chunks ?? [{ content: opts.body, axis: opts.axis }];
  chunks.forEach((c, i) => {
    db.prepare(
      `INSERT INTO memory_embeddings (id, memoryId, projectId, chunkIdx, content, vector, model, dim, sourceHash, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'h', ?)`,
    ).run(
      crypto.randomUUID(),
      id,
      opts.projectId,
      i,
      c.content,
      vectorToBlob(axisVector(c.axis)),
      EMBEDDING_MODEL,
      EMBEDDING_DIM,
      now,
    );
  });
  return id;
}

beforeAll(() => {
  const db = getDb();
  for (const [pid, name] of [
    [PROJECT_A, "Mem Search A"],
    [PROJECT_B, "Mem Search B"],
  ]) {
    db.prepare(
      `INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
       VALUES (?, ?, ?, 0, '[]', '[]', 'stage', 3)`,
    ).run(pid, name, `/tmp/${pid}`);
  }
});

afterEach(() => {
  const db = getDb();
  delete process.env.VK_DISABLE_EMBEDDINGS;
  for (const pid of [PROJECT_A, PROJECT_B]) {
    db.prepare("DELETE FROM memory_embeddings WHERE projectId = ?").run(pid);
    db.prepare("DELETE FROM project_memory WHERE projectId = ?").run(pid);
  }
});

afterAll(() => {
  const db = getDb();
  for (const pid of [PROJECT_A, PROJECT_B]) {
    db.prepare("DELETE FROM memory_embeddings WHERE projectId = ?").run(pid);
    db.prepare("DELETE FROM project_memory WHERE projectId = ?").run(pid);
  }
  db.prepare("DELETE FROM projects WHERE id IN (?, ?)").run(PROJECT_A, PROJECT_B);
});

describe("searchMemory — cross-project (projectId omitted)", () => {
  test("ranks across all projects and attributes each hit to its source project", async () => {
    const a = seedMemory({
      projectId: PROJECT_A,
      type: "gotcha",
      title: "A gotcha",
      body: "shared widget lesson",
      axis: 0,
    });
    const b = seedMemory({
      projectId: PROJECT_B,
      type: "decision",
      title: "B decision",
      body: "shared widget lesson",
      axis: 0,
    });

    const res = await searchMemory({ query: "widget", embedFn: fakeEmbed(0) });

    const byId = new Map(res.hits.map((h) => [h.id, h]));
    expect(byId.has(a)).toBe(true);
    expect(byId.has(b)).toBe(true);
    expect(byId.get(a)!.project).toEqual({ id: PROJECT_A, name: "Mem Search A" });
    expect(byId.get(b)!.project).toEqual({ id: PROJECT_B, name: "Mem Search B" });
    // Full event fields surface.
    expect(byId.get(a)!.type).toBe("gotcha");
    expect(byId.get(a)!.files).toEqual(["a.ts"]);
    expect(res.totalCandidates).toBe(2);
  });

  test("per-project mode is unchanged — no project attribution", async () => {
    seedMemory({
      projectId: PROJECT_A,
      type: "gotcha",
      title: "A",
      body: "scoped lesson",
      axis: 0,
    });
    seedMemory({
      projectId: PROJECT_B,
      type: "gotcha",
      title: "B",
      body: "scoped lesson",
      axis: 0,
    });

    const res = await searchMemory({
      projectId: PROJECT_A,
      query: "scoped",
      embedFn: fakeEmbed(0),
    });
    expect(res.totalCandidates).toBe(1); // only project A
    expect(res.hits.every((h) => h.project === undefined)).toBe(true);
  });

  test("excludes superseded by default; includes them on flag", async () => {
    const current = seedMemory({
      projectId: PROJECT_A,
      type: "decision",
      title: "current",
      body: "rrf fusion",
      axis: 0,
    });
    seedMemory({
      projectId: PROJECT_A,
      type: "decision",
      title: "old",
      body: "rrf fusion",
      axis: 0,
      supersededById: current,
    });

    const def = await searchMemory({ query: "rrf", embedFn: fakeEmbed(0) });
    expect(def.hits.map((h) => h.title)).toEqual(["current"]);

    const incl = await searchMemory({
      query: "rrf",
      embedFn: fakeEmbed(0),
      includeSuperseded: true,
    });
    expect(incl.hits.map((h) => h.title).sort()).toEqual(["current", "old"]);
  });

  test("type filter restricts results", async () => {
    seedMemory({
      projectId: PROJECT_A,
      type: "attempt_failed",
      title: "fail",
      body: "same body",
      axis: 0,
    });
    seedMemory({
      projectId: PROJECT_A,
      type: "decision",
      title: "dec",
      body: "same body",
      axis: 0,
    });

    const res = await searchMemory({
      query: "same",
      embedFn: fakeEmbed(0),
      type: "attempt_failed",
    });
    expect(res.hits.map((h) => h.title)).toEqual(["fail"]);
  });

  test("best-chunk-per-event dedup (one hit per event)", async () => {
    seedMemory({
      projectId: PROJECT_A,
      type: "decision",
      title: "multi",
      body: "canonical body",
      axis: 5,
      chunks: [
        { content: "irrelevant", axis: 20 },
        { content: "the matching part", axis: 0 },
      ],
    });
    const res = await searchMemory({ query: "matching", embedFn: fakeEmbed(0) });
    expect(res.hits.length).toBe(1);
    expect(res.hits[0].title).toBe("multi");
  });

  test("minScore floors on cosine", async () => {
    seedMemory({ projectId: PROJECT_A, type: "gotcha", title: "x", body: "orthogonal", axis: 10 });
    const res = await searchMemory({ query: "orthogonal", embedFn: fakeEmbed(0), minScore: 0.5 });
    expect(res.hits.length).toBe(0); // axis 10 vs query axis 0 → cosine 0
    expect(res.totalCandidates).toBe(1);
  });

  test("minScore -Infinity keeps negative-cosine hits (the injection no-floor path)", async () => {
    // An event whose embedding is the negation of the query vector → cosine -1.
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO project_memory (id, projectId, type, title, body, files, origin, createdAt)
       VALUES (?, ?, 'gotcha', 'anti', 'anti-correlated', '[]', 'ai_captured', ?)`,
    ).run(id, PROJECT_A, now);
    const neg = new Float32Array(EMBEDDING_DIM);
    neg[0] = -1; // dot with query axis-0 (=+1) → -1
    db.prepare(
      `INSERT INTO memory_embeddings (id, memoryId, projectId, chunkIdx, content, vector, model, dim, sourceHash, createdAt)
       VALUES (?, ?, ?, 0, 'anti', ?, ?, ?, 'h', ?)`,
    ).run(
      crypto.randomUUID(),
      id,
      PROJECT_A,
      vectorToBlob(neg),
      EMBEDDING_MODEL,
      EMBEDDING_DIM,
      now,
    );

    // Default floor (0) drops the negative-cosine hit…
    const floored = await searchMemory({ query: "anti", embedFn: fakeEmbed(0) });
    expect(floored.hits.length).toBe(0);
    expect(floored.totalCandidates).toBe(1); // it was a candidate, just filtered

    // …but -Infinity (the injection path) keeps it.
    const noFloor = await searchMemory({
      query: "anti",
      embedFn: fakeEmbed(0),
      minScore: -Infinity,
    });
    expect(noFloor.hits.map((h) => h.title)).toEqual(["anti"]);
    expect(noFloor.hits[0].score).toBeCloseTo(-1, 6);
  });

  test("kill-switch returns empty without embedding", async () => {
    seedMemory({ projectId: PROJECT_A, type: "gotcha", title: "x", body: "content", axis: 0 });
    process.env.VK_DISABLE_EMBEDDINGS = "1";
    let called = false;
    const res = await searchMemory({
      query: "content",
      embedFn: async () => {
        called = true;
        return axisVector(0);
      },
    });
    expect(res.hits).toEqual([]);
    expect(called).toBe(false);
  });

  test("empty corpus / whitespace query returns empty, never throws", async () => {
    expect((await searchMemory({ query: "anything", embedFn: fakeEmbed(0) })).hits).toEqual([]);
    expect((await searchMemory({ query: "   ", embedFn: fakeEmbed(0) })).hits).toEqual([]);
  });
});
