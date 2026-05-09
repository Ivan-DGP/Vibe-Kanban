import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { traceChain } from "./pipeline";

let tmpDir: string;
let db: Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chain-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      status TEXT,
      metadata TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE task_ai_runs (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      durationMs INTEGER,
      summary TEXT,
      createdAt TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
  `);
});

afterEach(() => {
  if (db) db.close();
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function insertTask(
  id: string,
  projectId: string,
  status: string,
  parent: string | null,
  createdAt: string,
): void {
  const meta = parent ? JSON.stringify({ parent_task: parent }) : "{}";
  db.prepare(
    "INSERT INTO tasks (id, projectId, status, metadata, createdAt) VALUES (?, ?, ?, ?, ?)",
  ).run(id, projectId, status, meta, createdAt);
}

function insertAiRun(id: string, taskId: string, durationMs: number, summary: string | null): void {
  db.prepare("INSERT INTO task_ai_runs (id, taskId, durationMs, summary) VALUES (?, ?, ?, ?)").run(
    id,
    taskId,
    durationMs,
    summary,
  );
}

describe("traceChain", () => {
  test("single task → depth=1, leaf=root", async () => {
    insertTask("root", "proj1", "done", null, "2026-01-01T00:00:00Z");
    insertAiRun("r1", "root", 100, null);

    const trace = await traceChain(() => db, "root", "proj1", 500, 5);
    expect(trace.depth).toBe(1);
    expect(trace.leafTaskId).toBe("root");
    expect(trace.leafStatus).toBe("done");
    expect(trace.parentLinksValid).toBe(true);
    expect(trace.totalAiRuns).toBe(1);
    expect(trace.totalDurationMs).toBe(100);
  });

  test("2-step chain: root → child", async () => {
    insertTask("root", "proj1", "done", null, "2026-01-01T00:00:00Z");
    insertAiRun("r1", "root", 100, null);
    insertTask("child", "proj1", "done", "root", "2026-01-01T00:00:01Z");
    insertAiRun("r2", "child", 200, null);

    const trace = await traceChain(() => db, "root", "proj1", 500, 5);
    expect(trace.depth).toBe(2);
    expect(trace.leafTaskId).toBe("child");
    expect(trace.leafStatus).toBe("done");
    expect(trace.parentLinksValid).toBe(true);
    expect(trace.totalAiRuns).toBe(2);
    expect(trace.totalDurationMs).toBe(300);
  });

  test("3-step chain: root → child → grandchild, capped by maxDepth", async () => {
    insertTask("a", "p", "done", null, "2026-01-01T00:00:00Z");
    insertAiRun("r1", "a", 10, null);
    insertTask("b", "p", "done", "a", "2026-01-01T00:00:01Z");
    insertAiRun("r2", "b", 20, null);
    insertTask("c", "p", "done", "b", "2026-01-01T00:00:02Z");
    insertAiRun("r3", "c", 30, null);

    const trace = await traceChain(() => db, "a", "p", 500, 5);
    expect(trace.depth).toBe(3);
    expect(trace.leafTaskId).toBe("c");
    expect(trace.parentLinksValid).toBe(true);
    expect(trace.totalAiRuns).toBe(3);
    expect(trace.totalDurationMs).toBe(60);
  });

  test("maxDepth caps deeper chains", async () => {
    insertTask("a", "p", "done", null, "2026-01-01T00:00:00Z");
    insertAiRun("r1", "a", 10, null);
    insertTask("b", "p", "done", "a", "2026-01-01T00:00:01Z");
    insertAiRun("r2", "b", 20, null);
    insertTask("c", "p", "done", "b", "2026-01-01T00:00:02Z");
    insertAiRun("r3", "c", 30, null);

    const trace = await traceChain(() => db, "a", "p", 500, 2);
    expect(trace.depth).toBe(2);
    expect(trace.leafTaskId).toBe("b");
  });

  test("chain isolated by projectId — does not cross projects", async () => {
    insertTask("root", "proj1", "done", null, "2026-01-01T00:00:00Z");
    insertAiRun("r1", "root", 10, null);
    insertTask("foreign", "proj2", "done", "root", "2026-01-01T00:00:01Z");
    insertAiRun("r2", "foreign", 99, null);

    const trace = await traceChain(() => db, "root", "proj1", 500, 5);
    expect(trace.depth).toBe(1);
    expect(trace.leafTaskId).toBe("root");
    expect(trace.totalAiRuns).toBe(1);
  });

  test("totalCostUsd sums claude JSON cost from each task_ai_run summary", async () => {
    insertTask("root", "p", "done", null, "2026-01-01T00:00:00Z");
    insertAiRun(
      "r1",
      "root",
      10,
      JSON.stringify({ result: "x", total_cost_usd: 0.05, session_id: "s1" }),
    );
    insertTask("child", "p", "done", "root", "2026-01-01T00:00:01Z");
    insertAiRun(
      "r2",
      "child",
      10,
      JSON.stringify({ result: "y", total_cost_usd: 0.07, session_id: "s2" }),
    );

    const trace = await traceChain(() => db, "root", "p", 500, 5);
    expect(trace.totalCostUsd).toBeCloseTo(0.12, 5);
  });
});
