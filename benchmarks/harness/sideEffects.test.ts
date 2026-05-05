import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { verifyTaskAiRun, verifyTimestampCascade, verifySnapshot, verifyEmbeddings, summarize } from "./sideEffects";

let tmpDir: string;
let db: Database;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "se-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      status TEXT,
      inboxAt TEXT,
      inProgressAt TEXT,
      doneAt TEXT
    );
    CREATE TABLE task_ai_runs (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      sessionId TEXT,
      exitCode INTEGER,
      success INTEGER,
      durationMs INTEGER,
      summary TEXT,
      createdAt TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
    CREATE TABLE task_embeddings (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      projectId TEXT NOT NULL,
      chunkIdx INTEGER,
      content TEXT,
      vector BLOB,
      model TEXT,
      dim INTEGER,
      sourceHash TEXT,
      createdAt TEXT
    );
  `);
});

afterEach(() => {
  if (db) db.close();
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("verifyTaskAiRun", () => {
  test("returns found=false when no row exists", () => {
    const result = verifyTaskAiRun(() => db, "missing");
    expect(result.found).toBe(false);
    expect(result.exitCode).toBe(null);
    expect(result.summarySet).toBe(false);
  });

  test("captures exitCode/success/durationMs/sessionId/summary when present", () => {
    db.prepare("INSERT INTO task_ai_runs (id, taskId, sessionId, exitCode, success, durationMs, summary) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("r1", "t1", "sess-abc", 0, 1, 1234, "ran ok");
    const result = verifyTaskAiRun(() => db, "t1");
    expect(result.found).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(1);
    expect(result.durationMs).toBe(1234);
    expect(result.sessionIdSet).toBe(true);
    expect(result.summarySet).toBe(true);
  });

  test("returns latest row when multiple exist (ORDER BY createdAt DESC)", () => {
    db.prepare("INSERT INTO task_ai_runs (id, taskId, exitCode, summary, createdAt) VALUES (?, ?, ?, ?, ?)")
      .run("r1", "t1", 1, "first", "2026-01-01T00:00:00Z");
    db.prepare("INSERT INTO task_ai_runs (id, taskId, exitCode, summary, createdAt) VALUES (?, ?, ?, ?, ?)")
      .run("r2", "t1", 0, "second", "2026-01-02T00:00:00Z");
    const result = verifyTaskAiRun(() => db, "t1");
    expect(result.exitCode).toBe(0);
  });
});

describe("verifyTimestampCascade", () => {
  test("returns all-false when task missing", () => {
    const result = verifyTimestampCascade(() => db, "missing");
    expect(result.inboxAtSet).toBe(false);
    expect(result.cascadeOrdered).toBe(false);
  });

  test("done task with full cascade reports allSet+ordered", () => {
    db.prepare("INSERT INTO tasks (id, projectId, status, inboxAt, inProgressAt, doneAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run("t1", "p1", "done", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", "2026-01-01T00:02:00Z");
    const result = verifyTimestampCascade(() => db, "t1");
    expect(result.inboxAtSet).toBe(true);
    expect(result.inProgressAtSet).toBe(true);
    expect(result.doneAtSet).toBe(true);
    expect(result.cascadeOrdered).toBe(true);
  });

  test("out-of-order timestamps reported as cascadeOrdered=false", () => {
    db.prepare("INSERT INTO tasks (id, projectId, status, inboxAt, inProgressAt, doneAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run("t1", "p1", "done", "2026-01-01T00:02:00Z", "2026-01-01T00:01:00Z", "2026-01-01T00:00:00Z");
    const result = verifyTimestampCascade(() => db, "t1");
    expect(result.cascadeOrdered).toBe(false);
  });

  test("partial cascade (only inbox) is ordered=true with later flags false", () => {
    db.prepare("INSERT INTO tasks (id, projectId, status, inboxAt) VALUES (?, ?, ?, ?)")
      .run("t1", "p1", "todo", "2026-01-01T00:00:00Z");
    const result = verifyTimestampCascade(() => db, "t1");
    expect(result.inboxAtSet).toBe(true);
    expect(result.inProgressAtSet).toBe(false);
    expect(result.doneAtSet).toBe(false);
    expect(result.cascadeOrdered).toBe(true);
  });
});

describe("verifySnapshot", () => {
  test("missing file returns fileExists=false", () => {
    const result = verifySnapshot(tmpDir, "p1", "t1");
    expect(result.fileExists).toBe(false);
    expect(result.taskInSnapshot).toBe(false);
  });

  test("file present + task included returns both true", () => {
    const tasksDir = path.join(tmpDir, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, "p1.json"), JSON.stringify({ tasks: [{ id: "t1" }, { id: "other" }] }));
    const result = verifySnapshot(tmpDir, "p1", "t1");
    expect(result.fileExists).toBe(true);
    expect(result.taskInSnapshot).toBe(true);
  });

  test("file present without target task returns taskInSnapshot=false", () => {
    const tasksDir = path.join(tmpDir, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, "p1.json"), JSON.stringify({ tasks: [{ id: "other" }] }));
    const result = verifySnapshot(tmpDir, "p1", "t1");
    expect(result.fileExists).toBe(true);
    expect(result.taskInSnapshot).toBe(false);
  });

  test("malformed JSON returns fileExists=true, taskInSnapshot=false", () => {
    const tasksDir = path.join(tmpDir, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, "p1.json"), "not json");
    const result = verifySnapshot(tmpDir, "p1", "t1");
    expect(result.fileExists).toBe(true);
    expect(result.taskInSnapshot).toBe(false);
  });
});

describe("verifyEmbeddings", () => {
  test("zero rows after settle window → skipped=true", async () => {
    const result = await verifyEmbeddings(() => db, "t1", 200);
    expect(result.rowCount).toBe(0);
    expect(result.skipped).toBe(true);
  });

  test("rows present → returns count and skipped=false", async () => {
    db.prepare("INSERT INTO task_embeddings (id, taskId, projectId, chunkIdx) VALUES (?, ?, ?, ?)").run("e1", "t1", "p1", 0);
    db.prepare("INSERT INTO task_embeddings (id, taskId, projectId, chunkIdx) VALUES (?, ?, ?, ?)").run("e2", "t1", "p1", 1);
    const result = await verifyEmbeddings(() => db, "t1", 200);
    expect(result.rowCount).toBe(2);
    expect(result.skipped).toBe(false);
  });
});

describe("summarize", () => {
  const fullChecks = {
    taskAiRun: { found: true, exitCode: 0, success: 1, durationMs: 100, sessionIdSet: true, summarySet: true },
    timestamps: { inboxAtSet: true, inProgressAtSet: true, doneAtSet: true, cascadeOrdered: true },
    snapshot: { fileExists: true, taskInSnapshot: true },
    embeddings: { rowCount: 1, skipped: false },
  };

  test("all green when every check passes", () => {
    const r = summarize(fullChecks);
    expect(r.allGreen).toBe(true);
  });

  test("missing taskAiRun fails allGreen", () => {
    const r = summarize({ ...fullChecks, taskAiRun: { ...fullChecks.taskAiRun, found: false } });
    expect(r.allGreen).toBe(false);
  });

  test("doneAt unset fails allGreen", () => {
    const r = summarize({ ...fullChecks, timestamps: { ...fullChecks.timestamps, doneAtSet: false } });
    expect(r.allGreen).toBe(false);
  });

  test("snapshot missing fails allGreen", () => {
    const r = summarize({ ...fullChecks, snapshot: { fileExists: false, taskInSnapshot: false } });
    expect(r.allGreen).toBe(false);
  });

  test("embeddings skipped is allowed (allGreen still true)", () => {
    const r = summarize({ ...fullChecks, embeddings: { rowCount: 0, skipped: true } });
    expect(r.allGreen).toBe(true);
  });

  test("embeddings rowCount=0 and not skipped fails allGreen", () => {
    const r = summarize({ ...fullChecks, embeddings: { rowCount: 0, skipped: false } });
    expect(r.allGreen).toBe(false);
  });
});
