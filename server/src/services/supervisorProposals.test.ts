import { describe, test, expect, beforeAll, afterEach, afterAll } from "bun:test";
import crypto from "node:crypto";
import { getDb } from "../db";
import { vectorToBlob, EMBEDDING_DIM, EMBEDDING_MODEL } from "./embeddings";
import { buildProposals } from "./supervisorProposals";
import type { SupervisorSignal } from "./supervisorSignals";
import type { EmbedFn } from "./memorySearch";

function axisVector(axis: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  v[axis] = 1;
  return v;
}
const fakeEmbed: EmbedFn = async (_t: string) => axisVector(0);

const PA = `__sup_prop_a_${crypto.randomUUID()}__`;
const PB = `__sup_prop_b_${crypto.randomUUID()}__`;

function sig(
  over: Partial<SupervisorSignal> & Pick<SupervisorSignal, "type" | "weightHint">,
): SupervisorSignal {
  const ref = over.ref ?? crypto.randomUUID();
  return {
    type: over.type,
    projectId: over.projectId ?? PA,
    ref,
    title: over.title ?? "signal title",
    detail: over.detail ?? "detail",
    signalKey: over.signalKey ?? `${over.type}:${ref}`,
    weightHint: over.weightHint,
  };
}

function seedArtifact(projectId: string, filename: string, content: string): string {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_artifacts (id, projectId, filename, type, description, tags, sizeBytes, mimeType, createdAt, updatedAt)
     VALUES (?, ?, ?, 'document', null, '[]', 0, 'text/markdown', ?, ?)`,
  ).run(id, projectId, filename, now, now);
  db.prepare(
    `INSERT INTO artifact_embeddings (id, artifactId, projectId, chunkIdx, content, vector, model, dim, createdAt)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    id,
    projectId,
    content,
    vectorToBlob(axisVector(0)),
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    now,
  );
  return id;
}

function seedMemory(projectId: string, title: string, memoryId?: string): string {
  const db = getDb();
  const id = memoryId ?? crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_memory (id, projectId, type, title, body, files, origin, createdAt)
     VALUES (?, ?, 'attempt_failed', ?, 'body', '[]', 'ai_captured', ?)`,
  ).run(id, projectId, title, now);
  db.prepare(
    `INSERT INTO memory_embeddings (id, memoryId, projectId, chunkIdx, content, vector, model, dim, sourceHash, createdAt)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'h', ?)`,
  ).run(
    crypto.randomUUID(),
    id,
    projectId,
    title,
    vectorToBlob(axisVector(0)),
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    now,
  );
  return id;
}

beforeAll(() => {
  const db = getDb();
  for (const p of [PA, PB]) {
    db.prepare(
      `INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
       VALUES (?, ?, ?, 0, '[]', '[]', 'stage', 3)`,
    ).run(p, p === PA ? "Proj A" : "Proj B", `/tmp/${p}`);
  }
});

afterEach(() => {
  delete process.env.VK_DISABLE_EMBEDDINGS;
  const db = getDb();
  for (const p of [PA, PB]) {
    db.prepare("DELETE FROM artifact_embeddings WHERE projectId = ?").run(p);
    db.prepare("DELETE FROM project_artifacts WHERE projectId = ?").run(p);
    db.prepare("DELETE FROM memory_embeddings WHERE projectId = ?").run(p);
    db.prepare("DELETE FROM project_memory WHERE projectId = ?").run(p);
  }
});

afterAll(() => {
  const db = getDb();
  for (const p of [PA, PB]) {
    db.prepare("DELETE FROM projects WHERE id = ?").run(p);
  }
});

describe("buildProposals", () => {
  test("ranks by weightHint desc and respects the limit", async () => {
    process.env.VK_DISABLE_EMBEDDINGS = "1"; // isolate ranking (no grounding)
    const signals = [
      sig({ type: "stalled", weightHint: 40, title: "s" }),
      sig({ type: "finding", weightHint: 100, title: "f" }),
      sig({ type: "unresolved", weightHint: 70, title: "u" }),
    ];
    const proposals = await buildProposals(signals, { limit: 2 });
    expect(proposals.map((p) => p.score)).toEqual([100, 70]); // top 2 by weight
    expect(proposals[0].signalType).toBe("finding");
    expect(proposals[0].grounded).toEqual({ knowledge: [], memory: [] });
  });

  test("grounds a proposal with cross-project knowledge + memory and composes rationale", async () => {
    seedArtifact(PB, "auth-spec.md", "oauth pkce flow guidance");
    seedMemory(PB, "PKCE flow, not implicit");

    const [proposal] = await buildProposals(
      [
        sig({
          type: "unresolved",
          weightHint: 70,
          projectId: PA,
          title: "oauth",
          detail: "failed oauth",
        }),
      ],
      { embedFn: fakeEmbed },
    );

    expect(proposal.grounded.knowledge.map((r) => r.label)).toContain("auth-spec.md");
    expect(proposal.grounded.knowledge[0].project).toBe("Proj B");
    expect(proposal.grounded.memory.map((r) => r.label)).toContain("PKCE flow, not implicit");
    expect(proposal.rationale).toContain("Related knowledge: auth-spec.md (Proj B)");
    expect(proposal.rationale).toContain("Related lessons:");
    expect(proposal.rationale).toContain("failed oauth"); // signal detail leads
  });

  test("excludes the signal's own memory event from grounding (no self-reference)", async () => {
    const ownId = crypto.randomUUID();
    seedMemory(PA, "the failed thing", ownId); // the signal's own source
    seedMemory(PB, "a different lesson");

    const [proposal] = await buildProposals(
      [sig({ type: "unresolved", weightHint: 70, projectId: PA, ref: ownId, title: "thing" })],
      { embedFn: fakeEmbed },
    );

    const ids = proposal.grounded.memory.map((r) => r.id);
    expect(ids).not.toContain(ownId);
    expect(proposal.grounded.memory.map((r) => r.label)).toContain("a different lesson");
  });

  test("kill-switch: proposals still produced with empty grounding", async () => {
    seedArtifact(PB, "doc.md", "content");
    process.env.VK_DISABLE_EMBEDDINGS = "1";
    const [proposal] = await buildProposals(
      [sig({ type: "roadmap", weightHint: 50, title: "x", detail: "planned item" })],
      { embedFn: fakeEmbed },
    );
    expect(proposal.grounded).toEqual({ knowledge: [], memory: [] });
    expect(proposal.rationale).toBe("planned item"); // just the detail, no refs
  });
});
