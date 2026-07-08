// Phase 2 — end-to-end verification of the "artifact loop":
//   create_artifact (MCP/HTTP) -> file on disk + DB row
//   list_artifacts (MCP/HTTP)  -> returns it
//   grounding (buildKnowledgeContext) -> selects artifacts as GroundedArtifact[]
//   task_ai_runs.groundedArtifacts round-trips through POST/GET ai-runs
//   record_run_deviations (MCP /mcp/run/:runId) -> persists task_ai_runs.deviations
//
// Offline-deterministic: embeddings are kill-switched (VK_DISABLE_EMBEDDINGS)
// so create_artifact's background embed is a no-op, and the grounding test
// injects a fake embedFn so the real Xenova model is never loaded.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";
import { getDb } from "../db";
import { getProjectArtifactsDir } from "../lib/data-dir";
import { setRunCwd, clearRunCwd } from "../services/runContext";
import { buildKnowledgeContext } from "../services/knowledgeInjection";
import { vectorToBlob, EMBEDDING_DIM, EMBEDDING_MODEL } from "../services/embeddings";
import fs from "node:fs";
import path from "node:path";

let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;
const prevDisable = process.env.VK_DISABLE_EMBEDDINGS;

beforeAll(async () => {
  process.env.VK_DISABLE_EMBEDDINGS = "1"; // no background model load on create_artifact
  app = await buildApp();
  await app.ready();

  const db = getDb();
  db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    "mcpEnabled",
    JSON.stringify(true),
  );
  db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    "mcpAuthRequired",
    JSON.stringify(false),
  );

  projectId = crypto.randomUUID();
  db.query("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    projectId,
    "artifact-loop-test",
    `/tmp/artifact-loop-${projectId}`,
  );
});

afterAll(() => {
  const db = getDb();
  db.query("DELETE FROM projects WHERE id = ?").run(projectId);
  if (prevDisable === undefined) delete process.env.VK_DISABLE_EMBEDDINGS;
  else process.env.VK_DISABLE_EMBEDDINGS = prevDisable;
});

function mcpCall(name: string, args: Record<string, unknown>, runId?: string) {
  return app.inject({
    method: "POST",
    url: runId ? `/mcp/run/${runId}` : "/mcp",
    headers: { "Content-Type": "application/json" },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
}

function toolResult(res: Awaited<ReturnType<typeof app.inject>>) {
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.json().result.content[0].text);
}

describe("artifact loop: create + list over MCP/HTTP", () => {
  test("create_artifact writes a file under the project artifacts dir + a DB row", async () => {
    const res = await mcpCall("create_artifact", {
      projectId,
      filename: "loop-spec.md",
      content: "# Spec\nThe widget must debounce input by 200ms.",
      type: "spec",
    });
    const artifact = toolResult(res);
    expect(artifact.error).toBeUndefined();
    expect(artifact.id).toBeTruthy();

    // DB row exists
    const row = getDb().prepare("SELECT * FROM project_artifacts WHERE id = ?").get(artifact.id) as
      | Record<string, unknown>
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.projectId).toBe(projectId);
    expect(row!.type).toBe("spec");

    // File on disk under getProjectArtifactsDir
    const dir = getProjectArtifactsDir(projectId);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(String(artifact.id)));
    expect(files.length).toBe(1);
    const onDisk = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(onDisk).toContain("debounce input by 200ms");
  });

  test("list_artifacts returns the created artifact", async () => {
    const created = toolResult(
      await mcpCall("create_artifact", {
        projectId,
        filename: "notes.md",
        content: "impl notes",
        type: "document",
      }),
    );
    const listed = toolResult(await mcpCall("list_artifacts", { projectId }));
    const arr = Array.isArray(listed) ? listed : (listed.artifacts ?? []);
    expect(arr.some((a: { id: string }) => a.id === created.id)).toBe(true);
  });
});

describe("artifact loop: grounding selects artifacts", () => {
  test("buildKnowledgeContext returns matching artifacts as GroundedArtifact[]", async () => {
    const db = getDb();
    const artifactId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO project_artifacts (id, projectId, filename, type, description, mimeType, sizeBytes)
       VALUES (?, ?, ?, 'spec', ?, 'text/markdown', 42)`,
    ).run(artifactId, projectId, "grounding.md", "Debounce spec");

    // Deterministic unit vector; the fake embedFn returns the same vector so
    // cosine similarity is 1.0 and the artifact ranks first.
    const vec = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] = i === 0 ? 1 : 0;
    db.prepare(
      `INSERT INTO artifact_embeddings (id, artifactId, projectId, chunkIdx, content, vector, model, dim)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      artifactId,
      projectId,
      "The widget debounces input by 200ms.",
      vectorToBlob(vec),
      EMBEDDING_MODEL,
      EMBEDDING_DIM,
    );

    // buildKnowledgeContext short-circuits if embeddings are disabled — enable
    // just for this call; embedFn is injected so no real model loads.
    delete process.env.VK_DISABLE_EMBEDDINGS;
    let ctx;
    try {
      ctx = await buildKnowledgeContext({
        projectId,
        query: "how should the widget handle rapid input?",
        embedFn: async () => vec,
      });
    } finally {
      process.env.VK_DISABLE_EMBEDDINGS = "1";
    }

    expect(ctx.artifacts.length).toBeGreaterThanOrEqual(1);
    expect(ctx.artifacts.some((a) => a.id === artifactId)).toBe(true);
    expect(ctx.block).toContain("debounces input");
  });
});

describe("artifact loop: run audit columns round-trip", () => {
  test("groundedArtifacts persists via POST ai-runs and parses back on GET", async () => {
    const db = getDb();
    const taskId = crypto.randomUUID();
    db.prepare("INSERT INTO tasks (id, projectId, title, status) VALUES (?, ?, ?, 'todo')").run(
      taskId,
      projectId,
      "grounded run task",
    );

    const grounded = [{ id: "art-1", title: "Debounce spec" }];
    const posted = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/ai-runs`,
      headers: { "Content-Type": "application/json" },
      payload: { profile: "feature", success: true, groundedArtifacts: grounded },
    });
    expect(posted.statusCode).toBe(200);
    expect(posted.json().groundedArtifacts).toEqual(grounded);

    const got = await app.inject({ method: "GET", url: `/api/tasks/${taskId}/ai-runs` });
    const runs = got.json();
    expect(runs[0].groundedArtifacts).toEqual(grounded);
  });

  test("record_run_deviations (MCP /mcp/run/:runId) persists task_ai_runs.deviations", async () => {
    const db = getDb();
    const taskId = crypto.randomUUID();
    db.prepare("INSERT INTO tasks (id, projectId, title, status) VALUES (?, ?, ?, 'todo')").run(
      taskId,
      projectId,
      "deviations task",
    );
    const runId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO task_ai_runs (id, taskId, projectId, profile, complexity, success) VALUES (?, ?, ?, 'feature', 'medium', 1)",
    ).run(runId, taskId, projectId);

    setRunCwd(runId, `/tmp/vk-wt-${runId}`);
    try {
      const res = await mcpCall(
        "record_run_deviations",
        { notes: "swapped debounce for throttle", artifactId: "impl-notes-1" },
        runId,
      );
      const out = toolResult(res);
      expect(out.error).toBeUndefined();
    } finally {
      clearRunCwd(runId);
    }

    const row = db.prepare("SELECT deviations FROM task_ai_runs WHERE id = ?").get(runId) as {
      deviations: string | null;
    };
    expect(row.deviations).toBeTruthy();
    const parsed = JSON.parse(row.deviations!);
    expect(parsed.notes).toBe("swapped debounce for throttle");
    expect(parsed.artifactId).toBe("impl-notes-1");
  });
});
