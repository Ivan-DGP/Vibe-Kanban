import { describe, test, expect, afterAll, afterEach } from "bun:test";
import { openDatabase, type DatabaseHandle } from "../lib/runtime";
import { _runMigrations } from "./index";
import { SCHEMA_SQL } from "./schema";
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";

/**
 * Tests that exercise ALL migration up() functions via the real runMigrations
 * from db/index.ts on a fresh database. This covers code paths that are
 * normally only called once on first run.
 */

const tmpDir = `/tmp/fresh-migrations-test-${Date.now()}`;
const openDbs: DatabaseHandle[] = [];

function freshDb(name: string): DatabaseHandle {
  mkdirSync(tmpDir, { recursive: true });
  const db = openDatabase(path.join(tmpDir, `${name}.db`));
  openDbs.push(db);
  return db;
}

afterAll(() => {
  for (const db of openDbs) {
    try { db.close(); } catch {}
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Full migration run from scratch using the REAL runMigrations
// ---------------------------------------------------------------------------

describe("fresh database: real runMigrations", () => {
  let db: DatabaseHandle;

  test("runs all migrations from version 1 to 14 on a blank database", () => {
    db = freshDb("real-run");

    // Set pragmas like getDb() does
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    // Call the REAL runMigrations from db/index.ts
    _runMigrations(db);

    // Verify all 14 migrations recorded
    const rows = db.prepare("SELECT version, name FROM _migrations ORDER BY version").all() as { version: number; name: string }[];
    expect(rows.length).toBe(14);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].version).toBe(i + 1);
    }
  });

  test("all expected tables exist after migrations", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    const expected = [
      "_migrations", "projects", "tasks", "milestones", "settings",
      "system_logs", "todos", "github_accounts", "project_github_mappings",
      "task_ai_runs", "api_collections", "api_requests",
    ];
    for (const t of expected) {
      expect(names).toContain(t);
    }
  });

  test("tasks table has all columns from all migrations", () => {
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);

    const expected = [
      "id", "projectId", "milestoneId", "title", "description", "prompt",
      "branch", "promptProfile", "status", "priority", "taskNumber", "sortOrder",
      "inboxAt", "inProgressAt", "doneAt", "approvedAt", "archivedAt",
      "parentTaskId", "createdAt", "updatedAt",
    ];
    for (const col of expected) {
      expect(colNames).toContain(col);
    }
  });

  test("tasks status CHECK constraint includes approved and archived", () => {
    const tableSql = (db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
    ).get() as any)?.sql || "";
    expect(tableSql).toContain("'approved'");
    expect(tableSql).toContain("'archived'");
  });

  test("projects table has treeDepth, aiInstructions, notionDatabaseId", () => {
    const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("treeDepth");
    expect(colNames).toContain("aiInstructions");
    expect(colNames).toContain("notionDatabaseId");
  });

  test("milestones table has aiInstructions", () => {
    const cols = db.prepare("PRAGMA table_info(milestones)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("aiInstructions");
  });

  test("api_collections and api_requests tables exist with correct columns", () => {
    const collCols = db.prepare("PRAGMA table_info(api_collections)").all() as { name: string }[];
    expect(collCols.map((c) => c.name)).toContain("projectId");
    expect(collCols.map((c) => c.name)).toContain("name");

    const reqCols = db.prepare("PRAGMA table_info(api_requests)").all() as { name: string }[];
    const reqColNames = reqCols.map((c) => c.name);
    expect(reqColNames).toContain("collectionId");
    expect(reqColNames).toContain("method");
    expect(reqColNames).toContain("url");
    expect(reqColNames).toContain("headers");
    expect(reqColNames).toContain("body");
  });

  test("task_ai_runs table exists with correct columns", () => {
    const cols = db.prepare("PRAGMA table_info(task_ai_runs)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("taskId");
    expect(colNames).toContain("projectId");
    expect(colNames).toContain("sessionId");
    expect(colNames).toContain("profile");
    expect(colNames).toContain("exitCode");
    expect(colNames).toContain("success");
  });

  test("can insert and query data through the migrated schema", () => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      "test-proj-1", "Test Project", "/tmp/test"
    );

    db.prepare(`
      INSERT INTO tasks (id, projectId, title, taskNumber, branch, promptProfile, status, approvedAt, archivedAt, parentTaskId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("task-1", "test-proj-1", "Test Task", 1, "feature/test", "auto", "approved", "2024-01-01", null, null);

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get("task-1") as any;
    expect(task.title).toBe("Test Task");
    expect(task.taskNumber).toBe(1);
    expect(task.branch).toBe("feature/test");
    expect(task.promptProfile).toBe("auto");
    expect(task.status).toBe("approved");
    expect(task.approvedAt).toBe("2024-01-01");
  });
});

// ---------------------------------------------------------------------------
// Idempotency: call runMigrations twice on the same DB
// ---------------------------------------------------------------------------

describe("runMigrations idempotency", () => {
  test("calling _runMigrations twice does not duplicate migrations or error", () => {
    const db = freshDb("idempotent");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    // First run
    _runMigrations(db);
    const countAfterFirst = (db.prepare("SELECT COUNT(*) as c FROM _migrations").get() as { c: number }).c;

    // Second run — should be a no-op
    _runMigrations(db);
    const countAfterSecond = (db.prepare("SELECT COUNT(*) as c FROM _migrations").get() as { c: number }).c;

    expect(countAfterFirst).toBe(14);
    expect(countAfterSecond).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Migration from completely empty database (no _migrations table)
// ---------------------------------------------------------------------------

describe("migration from completely empty database", () => {
  test("handles missing _migrations table and creates everything", () => {
    const db = freshDb("empty-start");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    // Verify no tables exist
    const tablesBefore = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tablesBefore.length).toBe(0);

    _runMigrations(db);

    const finalVersion = (db.prepare("SELECT MAX(version) as v FROM _migrations").get() as { v: number }).v;
    expect(finalVersion).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Migration with pre-existing data (exercises backfill in migration 2)
// ---------------------------------------------------------------------------

describe("migration 2: taskNumber backfill with real runMigrations", () => {
  test("assigns sequential task numbers per project when taskNumber is 0", () => {
    const db = freshDb("backfill");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    // Create schema manually (version 1 only)
    db.exec(SCHEMA_SQL);
    db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(1, "initial-schema");

    // Insert test data with taskNumber = 0
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run("p1", "Proj1", "/tmp/p1");
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run("p2", "Proj2", "/tmp/p2");

    db.prepare("INSERT INTO tasks (id, projectId, title, taskNumber, createdAt) VALUES (?, ?, ?, 0, '2024-01-01')").run("t1", "p1", "Task A");
    db.prepare("INSERT INTO tasks (id, projectId, title, taskNumber, createdAt) VALUES (?, ?, ?, 0, '2024-01-02')").run("t2", "p1", "Task B");
    db.prepare("INSERT INTO tasks (id, projectId, title, taskNumber, createdAt) VALUES (?, ?, ?, 0, '2024-01-01')").run("t3", "p2", "Task C");

    // Run remaining migrations (2+) via real code
    _runMigrations(db);

    const t1 = db.prepare("SELECT taskNumber FROM tasks WHERE id = ?").get("t1") as { taskNumber: number };
    const t2 = db.prepare("SELECT taskNumber FROM tasks WHERE id = ?").get("t2") as { taskNumber: number };
    const t3 = db.prepare("SELECT taskNumber FROM tasks WHERE id = ?").get("t3") as { taskNumber: number };

    expect(t1.taskNumber).toBe(1);
    expect(t2.taskNumber).toBe(2);
    expect(t3.taskNumber).toBe(1); // separate project, starts at 1

    // Verify all migrations completed
    const max = (db.prepare("SELECT MAX(version) as v FROM _migrations").get() as { v: number }).v;
    expect(max).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Partial migration: start from version 6 and run the rest
// ---------------------------------------------------------------------------

describe("partial migration from version 6", () => {
  test("runs migrations 7-14 on a DB already at version 6", () => {
    const db = freshDb("partial-v6");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    // Set up through version 6 by running full migrations first on a clean DB
    _runMigrations(db);

    // Now delete migration records for versions 7-14 to simulate a DB at version 6
    db.prepare("DELETE FROM _migrations WHERE version > 6").run();

    // Re-run — should only execute migrations 7+
    _runMigrations(db);

    const max = (db.prepare("SELECT MAX(version) as v FROM _migrations").get() as { v: number }).v;
    expect(max).toBe(14);

    // Verify the table still has all expected columns
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("approvedAt");
    expect(colNames).toContain("archivedAt");
    expect(colNames).toContain("parentTaskId");
    expect(colNames).toContain("promptProfile");
  });
});

// ---------------------------------------------------------------------------
// _resetDb and closeDb
// ---------------------------------------------------------------------------

describe("_resetDb utility", () => {
  test("_resetDb is exported and callable", async () => {
    const { _resetDb } = await import("./index");
    expect(typeof _resetDb).toBe("function");
    // Don't actually call it here since it would affect the global singleton
    // used by other tests. Just verify it exists.
  });
});
