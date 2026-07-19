import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import crypto from "node:crypto";
// Import from the real module first so it is fully loaded/cached before the mock
// replaces it — otherwise `...real` in the factory misses named exports.
import { EMBEDDING_DIM, EMBEDDING_MODEL, vectorToBlob } from "../services/embeddings";

// Stub embed() so appendMemory's background embed never loads the model.
mock.module("../services/embeddings", () => {
  const real = require("../services/embeddings");
  return {
    ...real,
    embed: async (_t: string) => {
      const v = new Float32Array(EMBEDDING_DIM);
      v[0] = 1;
      return v;
    },
  };
});

const { buildApp } = await import("../app");
import { getDb } from "../db";
import { appendMemory, supersede } from "../services/projectMemory";

let app: Awaited<ReturnType<typeof buildApp>>;
let db: ReturnType<typeof getDb>;
const PROJECT_ID = `__mem_route_${crypto.randomUUID()}__`;
// Second project, used only by the cross-project memory search describe block.
const PROJECT_ID_B = `__mem_route_b_${crypto.randomUUID()}__`;

// Directly seed a memory event + one embedding chunk (axis-0 vector matches the
// stubbed query embedding), bypassing the async background embed.
function seedMemoryRow(projectId: string, title: string, body: string): void {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const v = new Float32Array(EMBEDDING_DIM);
  v[0] = 1;
  db.prepare(
    `INSERT INTO project_memory (id, projectId, type, title, body, files, origin, createdAt)
     VALUES (?, ?, 'gotcha', ?, ?, '[]', 'ai_captured', ?)`,
  ).run(id, projectId, title, body, now);
  db.prepare(
    `INSERT INTO memory_embeddings (id, memoryId, projectId, chunkIdx, content, vector, model, dim, sourceHash, createdAt)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'h', ?)`,
  ).run(
    crypto.randomUUID(),
    id,
    projectId,
    body,
    vectorToBlob(v),
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    now,
  );
}

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url,
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify(payload),
  });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
     VALUES (?, ?, ?, 0, '[]', '[]', 'stage', 3)`,
  ).run(PROJECT_ID, "Mem Route Test", `/tmp/mem-route-${PROJECT_ID}`);
  db.prepare(
    `INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
     VALUES (?, ?, ?, 0, '[]', '[]', 'stage', 3)`,
  ).run(PROJECT_ID_B, "Mem Route Test B", `/tmp/mem-route-${PROJECT_ID_B}`);
});

const wipeMem = (pid: string) => {
  db.prepare("DELETE FROM memory_embeddings WHERE projectId = ?").run(pid);
  db.prepare("DELETE FROM project_memory WHERE projectId = ?").run(pid);
};

afterEach(() => {
  wipeMem(PROJECT_ID);
  wipeMem(PROJECT_ID_B);
});

afterAll(async () => {
  wipeMem(PROJECT_ID);
  wipeMem(PROJECT_ID_B);
  db.prepare("DELETE FROM projects WHERE id IN (?, ?)").run(PROJECT_ID, PROJECT_ID_B);
  await app.close();
});

describe("POST /api/projects/:id/memory", () => {
  test("appends an event and returns 201 with the persisted shape", async () => {
    const res = await post(`/api/projects/${PROJECT_ID}/memory`, {
      type: "decision",
      title: "Use hybrid retrieval",
      body: "FTS5 + vector via RRF",
      files: ["server/src/services/knowledgeRetrieval.ts"],
    });
    expect(res.statusCode).toBe(201);
    const { event } = res.json();
    expect(event.id).toBeTruthy();
    expect(event.type).toBe("decision");
    expect(event.origin).toBe("human"); // API default
    expect(event.files).toEqual(["server/src/services/knowledgeRetrieval.ts"]);
    expect(event.supersededBy).toBeNull();
  });

  test("rejects an invalid type with 400", async () => {
    const res = await post(`/api/projects/${PROJECT_ID}/memory`, { type: "nonsense", title: "x" });
    expect(res.statusCode).toBe(400);
  });

  test("rejects a missing title with 400", async () => {
    const res = await post(`/api/projects/${PROJECT_ID}/memory`, { type: "gotcha", title: "  " });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/projects/:id/memory", () => {
  test("lists newest-first, filters by type, and hides superseded by default", async () => {
    await post(`/api/projects/${PROJECT_ID}/memory`, { type: "decision", title: "D1" });
    await post(`/api/projects/${PROJECT_ID}/memory`, { type: "gotcha", title: "G1" });

    const all = (
      await app.inject({ method: "GET", url: `/api/projects/${PROJECT_ID}/memory` })
    ).json();
    expect(all.events.length).toBe(2);

    const decisions = (
      await app.inject({ method: "GET", url: `/api/projects/${PROJECT_ID}/memory?type=decision` })
    ).json();
    expect(decisions.events.length).toBe(1);
    expect(decisions.events[0].title).toBe("D1");
  });
});

describe("POST /api/projects/:id/memory/:id/supersede", () => {
  test("retires an entry by pointing it at a newer one", async () => {
    const oldEvent = (
      await post(`/api/projects/${PROJECT_ID}/memory`, { type: "decision", title: "Old" })
    ).json().event;
    const newEvent = (
      await post(`/api/projects/${PROJECT_ID}/memory`, { type: "decision", title: "New" })
    ).json().event;

    const sup = await post(`/api/projects/${PROJECT_ID}/memory/${oldEvent.id}/supersede`, {
      newEventId: newEvent.id,
    });
    expect(sup.statusCode).toBe(200);
    expect(sup.json().event.supersededBy).toBe(newEvent.id);

    // Default list now hides the superseded old entry.
    const visible = (
      await app.inject({ method: "GET", url: `/api/projects/${PROJECT_ID}/memory` })
    ).json();
    expect(visible.events.map((e: { title: string }) => e.title)).toEqual(["New"]);

    // includeSuperseded=true brings it back.
    const withSuperseded = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${PROJECT_ID}/memory?includeSuperseded=true`,
      })
    ).json();
    expect(withSuperseded.events.length).toBe(2);
  });

  test("400 when newEventId does not exist", async () => {
    const oldEvent = (
      await post(`/api/projects/${PROJECT_ID}/memory`, { type: "decision", title: "Old" })
    ).json().event;
    const res = await post(`/api/projects/${PROJECT_ID}/memory/${oldEvent.id}/supersede`, {
      newEventId: "does-not-exist",
    });
    expect(res.statusCode).toBe(400);
  });

  test("400 on self-supersede (no supersededBy self-loop)", async () => {
    const ev = (
      await post(`/api/projects/${PROJECT_ID}/memory`, { type: "decision", title: "Self" })
    ).json().event;
    const res = await post(`/api/projects/${PROJECT_ID}/memory/${ev.id}/supersede`, {
      newEventId: ev.id,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("projectMemory.supersede (service-level guard)", () => {
  test("rejects a self-loop even when called directly, bypassing the route", () => {
    const ev = appendMemory({ projectId: PROJECT_ID, type: "decision", title: "Direct" });
    expect(supersede(ev.id, ev.id)).toBeNull();
    // The row's supersededBy stays null (no self-loop persisted).
    const row = db.prepare("SELECT supersededBy FROM project_memory WHERE id = ?").get(ev.id) as {
      supersededBy: string | null;
    };
    expect(row.supersededBy).toBeNull();
  });
});

describe("GET /api/projects/:id/memory — input hardening", () => {
  test("non-numeric limit falls back to the default instead of 500", async () => {
    await post(`/api/projects/${PROJECT_ID}/memory`, { type: "decision", title: "D" });
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${PROJECT_ID}/memory?limit=abc`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events.length).toBe(1);
  });
});

describe("POST /api/cross-project/memory/search", () => {
  test("ranks memory across all projects and attributes each hit to its project", async () => {
    seedMemoryRow(PROJECT_ID, "A lesson", "shared widget note");
    seedMemoryRow(PROJECT_ID_B, "B lesson", "shared widget note");

    const res = await post(`/api/cross-project/memory/search`, { query: "widget" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalCandidates).toBe(2);
    const names = body.results.map((r: { project?: { name: string } }) => r.project?.name).sort();
    expect(names).toEqual(["Mem Route Test", "Mem Route Test B"]);
    expect(body.results.every((r: { project?: { id: string } }) => r.project?.id)).toBe(true);
  });

  test("missing query returns 400", async () => {
    const res = await post(`/api/cross-project/memory/search`, {});
    expect(res.statusCode).toBe(400);
  });
});
