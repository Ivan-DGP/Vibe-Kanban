import { describe, test, expect, beforeAll, afterEach, afterAll, mock } from "bun:test";
import crypto from "node:crypto";
import { EMBEDDING_DIM } from "./embeddings";

// Stub embed() so embedMemory runs without loading the transformer model. Tracks
// invocations so we can prove the kill-switch short-circuits BEFORE embed().
let embedCalls = 0;
mock.module("./embeddings", () => {
  const real = require("./embeddings");
  return {
    ...real,
    embed: async (_text: string): Promise<Float32Array> => {
      embedCalls++;
      const v = new Float32Array(EMBEDDING_DIM);
      v[0] = 1;
      return v;
    },
  };
});

import { composeMemoryText, embedMemory } from "./memoryEmbedder";
import { getDb } from "../db";

const PROJECT_ID = `__mem_embed_${crypto.randomUUID()}__`;

function insertMemory(id: string, title: string, body: string, type = "decision"): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_memory (id, projectId, type, title, body, origin, createdAt)
     VALUES (?, ?, ?, ?, ?, 'human', ?)`,
  ).run(id, PROJECT_ID, type, title, body, now);
}

beforeAll(() => {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
     VALUES (?, ?, ?, 0, '[]', '[]', 'stage', 3)`,
  ).run(PROJECT_ID, "Mem Embed Test", `/tmp/mem-${PROJECT_ID}`);
});

afterEach(() => {
  const db = getDb();
  delete process.env.VK_DISABLE_EMBEDDINGS;
  embedCalls = 0;
  db.prepare("DELETE FROM memory_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_memory WHERE projectId = ?").run(PROJECT_ID);
});

afterAll(() => {
  const db = getDb();
  db.prepare("DELETE FROM memory_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_memory WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM projects WHERE id = ?").run(PROJECT_ID);
});

describe("composeMemoryText", () => {
  test("includes title + type, and body/files when present", () => {
    const text = composeMemoryText({
      projectId: "p",
      memoryId: "m",
      type: "decision",
      title: "Use Bun",
      body: "Native TS + SQLite",
      files: ["server/src/db/index.ts"],
    });
    expect(text).toContain("# Use Bun");
    expect(text).toContain("Type: decision");
    expect(text).toContain("Native TS + SQLite");
    expect(text).toContain("Files: server/src/db/index.ts");
  });

  test("omits body and files when empty", () => {
    const text = composeMemoryText({
      projectId: "p",
      memoryId: "m",
      type: "gotcha",
      title: "Watch the WAL",
    });
    expect(text).toContain("# Watch the WAL");
    expect(text).toContain("Type: gotcha");
    expect(text).not.toContain("Files:");
  });
});

describe("embedMemory", () => {
  test("writes embedding rows for a memory event", async () => {
    const id = crypto.randomUUID();
    insertMemory(id, "Use RRF", "Fuse vector + lexical ranks");
    const n = await embedMemory({
      projectId: PROJECT_ID,
      memoryId: id,
      type: "decision",
      title: "Use RRF",
      body: "Fuse vector + lexical ranks",
    });
    expect(n).toBeGreaterThan(0);
    const rows = getDb()
      .prepare("SELECT COUNT(*) n FROM memory_embeddings WHERE memoryId = ?")
      .get(id) as { n: number };
    expect(rows.n).toBe(n);
    expect(embedCalls).toBeGreaterThan(0);
  });

  test("skips re-embedding when the composed text is unchanged (sourceHash gate)", async () => {
    const id = crypto.randomUUID();
    insertMemory(id, "Stable", "unchanged body");
    await embedMemory({
      projectId: PROJECT_ID,
      memoryId: id,
      type: "decision",
      title: "Stable",
      body: "unchanged body",
    });
    const firstCalls = embedCalls;
    const n2 = await embedMemory({
      projectId: PROJECT_ID,
      memoryId: id,
      type: "decision",
      title: "Stable",
      body: "unchanged body",
    });
    expect(n2).toBe(0);
    expect(embedCalls).toBe(firstCalls); // embed() not called again
  });

  test("kill-switch: VK_DISABLE_EMBEDDINGS=1 is a no-op (no model load, no rows)", async () => {
    const id = crypto.randomUUID();
    insertMemory(id, "Disabled", "body");
    process.env.VK_DISABLE_EMBEDDINGS = "1";
    const n = await embedMemory({
      projectId: PROJECT_ID,
      memoryId: id,
      type: "decision",
      title: "Disabled",
      body: "body",
    });
    expect(n).toBe(0);
    expect(embedCalls).toBe(0);
    const rows = getDb()
      .prepare("SELECT COUNT(*) n FROM memory_embeddings WHERE memoryId = ?")
      .get(id) as { n: number };
    expect(rows.n).toBe(0);
  });
});
