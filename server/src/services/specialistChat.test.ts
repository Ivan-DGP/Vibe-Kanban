import { describe, test, expect, beforeAll, afterEach, afterAll } from "bun:test";
import crypto from "node:crypto";
import { getDb } from "../db";
import { vectorToBlob, EMBEDDING_DIM, EMBEDDING_MODEL } from "./embeddings";
import type { EmbedFn } from "./memorySearch";
import { groundQuery, buildSpecialistPrompt, type SpecialistGrounding } from "./specialistChat";

function axisVector(axis: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  v[axis] = 1;
  return v;
}
const fakeEmbed =
  (axis: number): EmbedFn =>
  async () =>
    axisVector(axis);

const PROJECT_A = `__spec_chat_a_${crypto.randomUUID()}__`;
const PROJECT_B = `__spec_chat_b_${crypto.randomUUID()}__`;

function seedMemory(opts: {
  projectId: string;
  title: string;
  body: string;
  axis: number;
}): string {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_memory (id, projectId, type, title, body, files, origin, supersededBy, createdAt)
     VALUES (?, ?, 'gotcha', ?, ?, '["a.ts"]', 'ai_captured', NULL, ?)`,
  ).run(id, opts.projectId, opts.title, opts.body, now);
  db.prepare(
    `INSERT INTO memory_embeddings (id, memoryId, projectId, chunkIdx, content, vector, model, dim, sourceHash, createdAt)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'h', ?)`,
  ).run(
    crypto.randomUUID(),
    id,
    opts.projectId,
    opts.body,
    vectorToBlob(axisVector(opts.axis)),
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    now,
  );
  return id;
}

beforeAll(() => {
  const db = getDb();
  for (const [pid, name] of [
    [PROJECT_A, "Payments Service"],
    [PROJECT_B, "Auth Gateway"],
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
  db.prepare("DELETE FROM projects WHERE id IN (?, ?)").run(PROJECT_A, PROJECT_B);
});

describe("groundQuery — cross-project", () => {
  test("maps memory hits to attributed sources (id, label, kind, project, snippet)", async () => {
    seedMemory({
      projectId: PROJECT_A,
      title: "Widget retry gotcha",
      body: "we retried the charge and it double-billed",
      axis: 0,
    });
    seedMemory({
      projectId: PROJECT_B,
      title: "JWT rotation lesson",
      body: "rotate keys",
      axis: 1,
    });

    const g = await groundQuery("how do we retry charges", { embedFn: fakeEmbed(0) });

    const hit = g.memory.find((m) => m.label === "Widget retry gotcha");
    expect(hit).toBeTruthy();
    expect(hit!.id).toBeTruthy();
    expect(hit!.kind).toBe("memory");
    expect(hit!.project).toBe("Payments Service"); // cross-project attribution
    expect(hit!.snippet).toContain("double-billed");
    // Knowledge source ran (none seeded) without throwing.
    expect(Array.isArray(g.knowledge)).toBe(true);
  });

  test("kill-switch (VK_DISABLE_EMBEDDINGS) → empty grounding, never throws", async () => {
    process.env.VK_DISABLE_EMBEDDINGS = "1";
    seedMemory({ projectId: PROJECT_A, title: "Ignored", body: "x", axis: 0 });
    const g = await groundQuery("anything");
    expect(g).toEqual({ knowledge: [], memory: [] });
  });
});

describe("buildSpecialistPrompt", () => {
  const grounding: SpecialistGrounding = {
    knowledge: [{ id: "a1", kind: "artifact", label: "retry.md", project: "Payments" }],
    memory: [
      { id: "m1", kind: "memory", label: "Retry gotcha", project: "Auth", snippet: "use backoff" },
    ],
  };

  test("includes grounded refs, the question, and a cite instruction", () => {
    const p = buildSpecialistPrompt("How should we retry?", grounding);
    expect(p).toContain("[artifact] retry.md (Payments)");
    expect(p).toContain("Retry gotcha (Auth): use backoff");
    expect(p).toContain("How should we retry?");
    expect(p.toLowerCase()).toContain("cite");
  });

  test("empty grounding → a no-match note plus the question", () => {
    const p = buildSpecialistPrompt("anything at all", { knowledge: [], memory: [] });
    expect(p).toContain("No indexed knowledge or memory matched");
    expect(p).toContain("anything at all");
  });
});
