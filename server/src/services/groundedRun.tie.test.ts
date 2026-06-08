import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import crypto from "node:crypto";
import { buildApp } from "../app";
import { getDb } from "../db";
import { vectorToBlob, EMBEDDING_DIM, EMBEDDING_MODEL } from "./embeddings";
import { buildKnowledgeContext } from "./knowledgeInjection";
import type { TaskAiRun } from "@vibe-kanban/shared";

// O6 tie-to-O2: prove the grounded-artifact list PERSISTED on a run record is
// exactly the set of artifacts O2's knowledge-injection helper selected for
// that run's prompt — retrievable through the runs API.

const PROJECT_ID = `__o6_tie_proj_${crypto.randomUUID()}__`;
const TASK_ID = `__o6_tie_task_${crypto.randomUUID()}__`;

let app: Awaited<ReturnType<typeof buildApp>>;
let db: ReturnType<typeof getDb>;

// Deterministic axis unit-vectors so we control ranking without the real model.
function axisVector(axis: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  v[axis] = 1;
  return v;
}

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
  ).run(PROJECT_ID, "O6 Tie Project", `/tmp/o6-tie-${PROJECT_ID}`);
  db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
    TASK_ID,
    PROJECT_ID,
    "Implement login flow",
  );
});

afterAll(async () => {
  db.prepare("DELETE FROM task_ai_runs WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM artifact_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_artifacts WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM tasks WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM projects WHERE id = ?").run(PROJECT_ID);
});

afterEach(() => {
  delete process.env.VK_DISABLE_EMBEDDINGS;
  db.prepare("DELETE FROM task_ai_runs WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM artifact_embeddings WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM project_artifacts WHERE projectId = ?").run(PROJECT_ID);
});

async function recordRun(groundedArtifacts: { id: string; title: string }[]): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/tasks/${TASK_ID}/ai-runs`,
    payload: { profile: "feature", complexity: "medium", success: true, groundedArtifacts },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).id as string;
}

async function readRuns(): Promise<TaskAiRun[]> {
  const res = await app.inject({ method: "GET", url: `/api/tasks/${TASK_ID}/ai-runs` });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body) as TaskAiRun[];
}

describe("O6 grounded-artifact persistence ties to O2 injection", () => {
  test("persisted grounded ids match the artifacts buildKnowledgeContext selected", async () => {
    seedArtifact({ title: "Auth Service Design", content: "OAuth login flow details", axis: 0 });
    seedArtifact({ title: "Billing Pipeline", content: "Stripe invoice reconciliation", axis: 50 });
    seedArtifact({ title: "Map Rendering", content: "Leaflet tile cache strategy", axis: 100 });

    // Query aligns with axis 0 → Auth artifact scores highest; the others (very
    // different axes) score 0. Same helper O2's injection uses to build the block.
    const embedFn = async () => axisVector(0);
    const ctx = await buildKnowledgeContext({
      projectId: PROJECT_ID,
      query: "how does login work",
      embedFn,
    });

    // O2 actually injected something, and we know exactly what.
    expect(ctx.block).toContain("Auth Service Design");
    expect(ctx.artifacts.length).toBeGreaterThan(0);
    const selectedIds = ctx.artifacts.map((a) => a.id);

    // Persist a run carrying exactly that list, then read it back through the API.
    const runId = await recordRun(ctx.artifacts);
    const runs = await readRuns();
    const run = runs.find((r) => r.id === runId);
    expect(run).toBeTruthy();

    const persistedIds = (run!.groundedArtifacts ?? []).map((a) => a.id);
    // Key tie-to-O2 assertion: persisted ids === ids the helper selected.
    expect(persistedIds).toEqual(selectedIds);
    // Titles round-trip too.
    expect((run!.groundedArtifacts ?? [])[0].title).toBe("Auth Service Design");
  });

  test("empty grounded list persists as [] when embeddings disabled", async () => {
    seedArtifact({ title: "Auth Service Design", content: "OAuth login flow", axis: 0 });
    process.env.VK_DISABLE_EMBEDDINGS = "1";

    const embedFn = async () => axisVector(0);
    const ctx = await buildKnowledgeContext({
      projectId: PROJECT_ID,
      query: "how does login work",
      embedFn,
    });
    expect(ctx.block).toBe("");
    expect(ctx.artifacts).toEqual([]);

    const runId = await recordRun(ctx.artifacts);
    const runs = await readRuns();
    const run = runs.find((r) => r.id === runId);
    expect(run).toBeTruthy();
    expect(run!.groundedArtifacts).toEqual([]);
  });

  test("byte-budget-dropped artifacts are NOT persisted (list mirrors rendered block)", async () => {
    // Many oversized artifacts with equal scores: the byte budget keeps only a
    // prefix in the block — the persisted list must match that prefix exactly.
    const big = "lorem ipsum ".repeat(2000);
    for (let i = 0; i < 8; i++) seedArtifact({ title: `Doc ${i}`, content: big, axis: i });
    const embedFn = async () => {
      const v = new Float32Array(EMBEDDING_DIM);
      for (let i = 0; i < 8; i++) v[i] = 1; // tie all scores
      return v;
    };
    const ctx = await buildKnowledgeContext({
      projectId: PROJECT_ID,
      query: "give me everything",
      embedFn,
    });

    // Every persisted artifact's title must appear in the rendered block; none dropped.
    for (const a of ctx.artifacts) expect(ctx.block).toContain(a.title);

    const runId = await recordRun(ctx.artifacts);
    const runs = await readRuns();
    const run = runs.find((r) => r.id === runId)!;
    const persistedIds = (run.groundedArtifacts ?? []).map((a) => a.id);
    expect(persistedIds).toEqual(ctx.artifacts.map((a) => a.id));
  });
});
