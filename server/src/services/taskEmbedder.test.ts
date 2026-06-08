import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import crypto from "node:crypto";
import { EMBEDDING_DIM } from "./embeddings";

// Stub embed() so embedTask runs without loading the transformer model. Tracks
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

import { composeTaskText, embedTask } from "./taskEmbedder";
import { getDb } from "../db";

describe("composeTaskText", () => {
  test("includes title only when other fields are empty", () => {
    const text = composeTaskText({
      projectId: "p",
      taskId: "t",
      title: "Add login flow",
    });
    expect(text).toContain("# Add login flow");
    expect(text).not.toContain("Status:");
    expect(text).not.toContain("Prompt:");
  });

  test("includes status when provided", () => {
    const text = composeTaskText({
      projectId: "p",
      taskId: "t",
      title: "Foo",
      status: "in_progress",
    });
    expect(text).toContain("Status: in_progress");
  });

  test("includes description and prompt when provided", () => {
    const text = composeTaskText({
      projectId: "p",
      taskId: "t",
      title: "Add OAuth",
      description: "Support GitHub login",
      prompt: "Implement Passport.js GitHub strategy",
    });
    expect(text).toContain("# Add OAuth");
    expect(text).toContain("Support GitHub login");
    expect(text).toContain("Prompt:");
    expect(text).toContain("Passport.js GitHub strategy");
  });

  test("trims whitespace and ignores empty fields", () => {
    const text = composeTaskText({
      projectId: "p",
      taskId: "t",
      title: "  Trim me  ",
      description: "   ",
      prompt: "",
    });
    expect(text).toContain("# Trim me");
    expect(text).not.toContain("Prompt:");
  });

  test("handles null fields gracefully", () => {
    const text = composeTaskText({
      projectId: "p",
      taskId: "t",
      title: "Hello",
      description: null,
      prompt: null,
      status: null,
    });
    expect(text).toBe("# Hello");
  });
});

describe("embedTask kill-switch", () => {
  const PROJECT_ID = `__test_task_embedder_${crypto.randomUUID()}__`;
  const TASK_ID = crypto.randomUUID();
  let db: ReturnType<typeof getDb>;

  function taskRowCount(): number {
    return (
      db.prepare("SELECT COUNT(*) as n FROM task_embeddings WHERE taskId = ?").get(TASK_ID) as {
        n: number;
      }
    ).n;
  }

  beforeAll(() => {
    db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO projects (id, name, path, favorite, techStack, externalLinks, aiCommitMode, treeDepth)
       VALUES (?, ?, ?, 0, '[]', '[]', 'stage', 3)`,
    ).run(PROJECT_ID, "Task Embedder Test", `/tmp/task-embedder-${PROJECT_ID}`);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tasks (id, projectId, title, description, status, priority, sortOrder, createdAt, updatedAt, inboxAt)
       VALUES (?, ?, ?, ?, 'backlog', 'medium', 1, ?, ?, ?)`,
    ).run(
      TASK_ID,
      PROJECT_ID,
      "Embeddable task",
      "with a description long enough to chunk",
      now,
      now,
      now,
    );
  });

  afterEach(() => {
    delete process.env.VK_DISABLE_EMBEDDINGS;
    embedCalls = 0;
    db.prepare("DELETE FROM task_embeddings WHERE taskId = ?").run(TASK_ID);
  });

  afterAll(() => {
    db.prepare("DELETE FROM task_embeddings WHERE taskId = ?").run(TASK_ID);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(TASK_ID);
    db.prepare("DELETE FROM projects WHERE id = ?").run(PROJECT_ID);
  });

  test("VK_DISABLE_EMBEDDINGS=1 makes embedTask a no-op (no model load, no rows)", async () => {
    process.env.VK_DISABLE_EMBEDDINGS = "1";
    const n = await embedTask({
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      title: "Embeddable task",
      description: "with a description long enough to chunk",
      status: "backlog",
    });
    expect(n).toBe(0);
    expect(taskRowCount()).toBe(0);
    expect(embedCalls).toBe(0);
  });

  test("without the switch, embedTask writes embedding rows", async () => {
    const n = await embedTask({
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      title: "Embeddable task",
      description: "with a description long enough to chunk",
      status: "backlog",
    });
    expect(n).toBeGreaterThan(0);
    expect(taskRowCount()).toBe(n);
    expect(embedCalls).toBeGreaterThan(0);
  });
});
