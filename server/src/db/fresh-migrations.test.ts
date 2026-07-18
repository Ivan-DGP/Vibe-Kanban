import { describe, test, expect, afterAll } from "bun:test";
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
    try {
      db.close();
    } catch {}
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

// ---------------------------------------------------------------------------
// Full migration run from scratch using the REAL runMigrations
// ---------------------------------------------------------------------------

describe("fresh database: real runMigrations", () => {
  let db: DatabaseHandle;

  test("runs all migrations from version 1 to 38 on a blank database", () => {
    db = freshDb("real-run");

    // Set pragmas like getDb() does
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    // Call the REAL runMigrations from db/index.ts
    _runMigrations(db);

    // Verify all migrations recorded
    const rows = db.prepare("SELECT version, name FROM _migrations ORDER BY version").all() as {
      version: number;
      name: string;
    }[];
    expect(rows.length).toBe(38);
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
      "_migrations",
      "projects",
      "tasks",
      "milestones",
      "settings",
      "system_logs",
      "todos",
      "github_accounts",
      "project_github_mappings",
      "task_ai_runs",
      "api_collections",
      "api_requests",
      "project_artifacts",
      "project_graph_nodes",
      "project_graph_edges",
      "roadmap_items",
      "roadmap_item_tasks",
      "task_ai_findings",
      "artifact_pending_links",
      "claude_sessions",
    ];
    for (const t of expected) {
      expect(names).toContain(t);
    }
  });

  test("graph tables have status + origin columns (migration 33)", () => {
    for (const table of ["project_graph_nodes", "project_graph_edges"]) {
      const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols).toContain("status");
      expect(cols).toContain("origin");
    }
  });

  test("migration 33 backfills pre-existing graph rows to status='confirmed'", () => {
    const old = freshDb("pre-v33");
    old.exec("PRAGMA foreign_keys = ON");

    // Simulate a pre-v33 database: graph tables WITHOUT status/origin, and a
    // _migrations ledger already at version 32 so migrations 33+ run.
    old.exec(`
      CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT);
      CREATE TABLE project_graph_nodes (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        label TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'concept', description TEXT,
        x REAL, y REAL, metadata TEXT NOT NULL DEFAULT '{}', createdAt TEXT, updatedAt TEXT
      );
      CREATE TABLE project_graph_edges (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        sourceNodeId TEXT NOT NULL REFERENCES project_graph_nodes(id) ON DELETE CASCADE,
        targetNodeId TEXT NOT NULL REFERENCES project_graph_nodes(id) ON DELETE CASCADE,
        label TEXT, type TEXT NOT NULL DEFAULT 'related', createdAt TEXT
      );
      -- Minimal tasks table so later migrations that ALTER it (e.g. v37 add-task-agent) run.
      CREATE TABLE tasks (id TEXT PRIMARY KEY);
    `);
    for (let v = 1; v <= 32; v++) {
      old.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(v, `seed-${v}`);
    }
    old.prepare("INSERT INTO projects (id, name, path) VALUES ('p1','P','/tmp/p1')").run();
    old
      .prepare("INSERT INTO project_graph_nodes (id, projectId, label) VALUES ('n1','p1','Old')")
      .run();
    old
      .prepare("INSERT INTO project_graph_nodes (id, projectId, label) VALUES ('n2','p1','Old2')")
      .run();
    old
      .prepare(
        "INSERT INTO project_graph_edges (id, projectId, sourceNodeId, targetNodeId) VALUES ('e1','p1','n1','n2')",
      )
      .run();

    _runMigrations(old);

    const node = old
      .prepare("SELECT status, origin FROM project_graph_nodes WHERE id='n1'")
      .get() as { status: string; origin: string | null };
    expect(node.status).toBe("confirmed");
    expect(node.origin).toBeNull();
    const edge = old
      .prepare("SELECT status, origin FROM project_graph_edges WHERE id='e1'")
      .get() as { status: string; origin: string | null };
    expect(edge.status).toBe("confirmed");

    const maxV = old.prepare("SELECT MAX(version) v FROM _migrations").get() as { v: number };
    expect(maxV.v).toBe(38);
  });

  test("tasks table has all columns from all migrations", () => {
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);

    const expected = [
      "id",
      "projectId",
      "milestoneId",
      "title",
      "description",
      "prompt",
      "branch",
      "promptProfile",
      "status",
      "priority",
      "taskNumber",
      "sortOrder",
      "inboxAt",
      "inProgressAt",
      "doneAt",
      "approvedAt",
      "archivedAt",
      "parentTaskId",
      "createdAt",
      "updatedAt",
    ];
    for (const col of expected) {
      expect(colNames).toContain(col);
    }
  });

  test("tasks status CHECK constraint includes approved and archived", () => {
    const tableSql =
      (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as any)
        ?.sql || "";
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
    // O6: grounded-artifact audit column (migration 31).
    expect(colNames).toContain("groundedArtifacts");
  });

  test("can insert and query data through the migrated schema", () => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      "test-proj-1",
      "Test Project",
      "/tmp/test",
    );

    db.prepare(
      `
      INSERT INTO tasks (id, projectId, title, taskNumber, branch, promptProfile, status, approvedAt, archivedAt, parentTaskId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      "task-1",
      "test-proj-1",
      "Test Task",
      1,
      "feature/test",
      "auto",
      "approved",
      "2024-01-01",
      null,
      null,
    );

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
    const countAfterFirst = (
      db.prepare("SELECT COUNT(*) as c FROM _migrations").get() as { c: number }
    ).c;

    // Second run — should be a no-op
    _runMigrations(db);
    const countAfterSecond = (
      db.prepare("SELECT COUNT(*) as c FROM _migrations").get() as { c: number }
    ).c;

    expect(countAfterFirst).toBe(38);
    expect(countAfterSecond).toBe(38);
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
    const tablesBefore = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    expect(tablesBefore.length).toBe(0);

    _runMigrations(db);

    const finalVersion = (
      db.prepare("SELECT MAX(version) as v FROM _migrations").get() as { v: number }
    ).v;
    expect(finalVersion).toBe(38);
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
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      "p1",
      "Proj1",
      "/tmp/p1",
    );
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      "p2",
      "Proj2",
      "/tmp/p2",
    );

    db.prepare(
      "INSERT INTO tasks (id, projectId, title, taskNumber, createdAt) VALUES (?, ?, ?, 0, '2024-01-01')",
    ).run("t1", "p1", "Task A");
    db.prepare(
      "INSERT INTO tasks (id, projectId, title, taskNumber, createdAt) VALUES (?, ?, ?, 0, '2024-01-02')",
    ).run("t2", "p1", "Task B");
    db.prepare(
      "INSERT INTO tasks (id, projectId, title, taskNumber, createdAt) VALUES (?, ?, ?, 0, '2024-01-01')",
    ).run("t3", "p2", "Task C");

    // Run remaining migrations (2+) via real code
    _runMigrations(db);

    const t1 = db.prepare("SELECT taskNumber FROM tasks WHERE id = ?").get("t1") as {
      taskNumber: number;
    };
    const t2 = db.prepare("SELECT taskNumber FROM tasks WHERE id = ?").get("t2") as {
      taskNumber: number;
    };
    const t3 = db.prepare("SELECT taskNumber FROM tasks WHERE id = ?").get("t3") as {
      taskNumber: number;
    };

    expect(t1.taskNumber).toBe(1);
    expect(t2.taskNumber).toBe(2);
    expect(t3.taskNumber).toBe(1); // separate project, starts at 1

    // Verify all migrations completed
    const max = (db.prepare("SELECT MAX(version) as v FROM _migrations").get() as { v: number }).v;
    expect(max).toBe(38);
  });
});

// ---------------------------------------------------------------------------
// Partial migration: start from version 6 and run the rest
// ---------------------------------------------------------------------------

describe("partial migration from version 6", () => {
  test("runs migrations 7-20 on a DB already at version 6", () => {
    const db = freshDb("partial-v6");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    // Set up through version 6 by running full migrations first on a clean DB
    _runMigrations(db);

    // Now delete migration records for versions 7-22 to simulate a DB at version 6
    db.prepare("DELETE FROM _migrations WHERE version > 6").run();

    // Re-run — should only execute migrations 7+
    _runMigrations(db);

    const max = (db.prepare("SELECT MAX(version) as v FROM _migrations").get() as { v: number }).v;
    expect(max).toBe(38);

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

describe("closeDb", () => {
  test("closes the singleton so the next getDb() reopens", async () => {
    const { getDb, closeDb } = await import("./index");
    const first = getDb();
    // Ensure connection works
    first.prepare("SELECT 1 AS one").get();
    closeDb();
    // After close, getDb must return a fresh, working handle
    const second = getDb();
    const row = second.prepare("SELECT 1 AS one").get() as { one: number };
    expect(row.one).toBe(1);
  });

  test("is a no-op when no db is open", async () => {
    const { closeDb, _resetDb } = await import("./index");
    _resetDb();
    // Second close with no handle should not throw
    expect(() => closeDb()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Migration 8: rebuild-tasks-check-constraint body (lines 218-252)
// Exercises the code path where tasks table exists at v7 but does NOT yet
// include 'approved' in the CHECK constraint.
// We build a minimal schema manually (not using SCHEMA_SQL which is already current).
// ---------------------------------------------------------------------------

// Old-style minimal schema WITHOUT 'approved' in status CHECK
const OLD_TASKS_SCHEMA_SQL = `
CREATE TABLE _migrations (
  version   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  appliedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  path         TEXT NOT NULL UNIQUE,
  favorite     INTEGER NOT NULL DEFAULT 0,
  category     TEXT DEFAULT NULL,
  techStack    TEXT NOT NULL DEFAULT '[]',
  externalLinks TEXT NOT NULL DEFAULT '[]',
  aiCommitMode TEXT NOT NULL DEFAULT 'stage',
  createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE milestones (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestoneId  TEXT DEFAULT NULL REFERENCES milestones(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT DEFAULT NULL,
  prompt       TEXT DEFAULT NULL,
  branch       TEXT DEFAULT NULL,
  status       TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'todo', 'in_progress', 'done')),
  priority     TEXT NOT NULL DEFAULT 'medium',
  taskNumber   INTEGER NOT NULL DEFAULT 0,
  sortOrder    REAL NOT NULL DEFAULT 0,
  inboxAt      TEXT DEFAULT NULL,
  inProgressAt TEXT DEFAULT NULL,
  doneAt       TEXT DEFAULT NULL,
  approvedAt   TEXT DEFAULT NULL,
  createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE todos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  completed    INTEGER NOT NULL DEFAULT 0,
  linkedTaskId TEXT DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL,
  sortOrder    REAL NOT NULL DEFAULT 0,
  createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE settings (
  key       TEXT PRIMARY KEY,
  value     TEXT NOT NULL,
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE system_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  level     TEXT NOT NULL DEFAULT 'info',
  category  TEXT NOT NULL DEFAULT 'server',
  message   TEXT NOT NULL,
  details   TEXT DEFAULT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE github_accounts (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  token     TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE project_github_mappings (
  projectId       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subPath         TEXT NOT NULL DEFAULT '',
  githubAccountId TEXT NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (projectId, subPath)
);
`;

describe("migration 8 body: rebuild tasks constraint when 'approved' is absent", () => {
  test("runs the full rebuild when table SQL lacks 'approved' (with approvedAt col)", () => {
    const db = freshDb("migration8-body");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = OFF");

    // Use old-style schema (status CHECK without 'approved')
    db.exec(OLD_TASKS_SCHEMA_SQL);

    // Mark migrations 1-7 as done WITHOUT running migration 7's actual rebuild
    // The tasks table has approvedAt but NOT 'approved' in the status constraint
    for (let v = 1; v <= 7; v++) {
      db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(v, `migration-${v}`);
    }

    db.exec("PRAGMA foreign_keys = ON");

    // Confirm tasks table SQL does NOT yet include 'approved' status
    const sqlBefore =
      (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as any)
        ?.sql || "";
    expect(sqlBefore).not.toContain("'approved'");

    // Confirm approvedAt column DOES exist (so hasApprovedAt branch = true)
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "approvedAt")).toBe(true);

    // Run migrations — only v8+ execute (v7 already "recorded")
    _runMigrations(db);

    // After migration 8 runs, tasks table should have 'approved' in constraint
    const sqlAfter =
      (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as any)
        ?.sql || "";
    expect(sqlAfter).toContain("'approved'");

    // Migration 8 should be recorded
    const v8 = db.prepare("SELECT version FROM _migrations WHERE version = 8").get();
    expect(v8).toBeTruthy();
  });

  test("migration 8 with hasApprovedAt=false: inserts NULL for approvedAt in rebuild", () => {
    const db = freshDb("migration8-no-approvedat");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = OFF");

    // Use the old-style schema but remove approvedAt from tasks table
    db.exec(`
      CREATE TABLE _migrations (
        version   INTEGER PRIMARY KEY,
        name      TEXT NOT NULL,
        appliedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        favorite INTEGER NOT NULL DEFAULT 0, category TEXT DEFAULT NULL,
        techStack TEXT NOT NULL DEFAULT '[]', externalLinks TEXT NOT NULL DEFAULT '[]',
        aiCommitMode TEXT NOT NULL DEFAULT 'stage',
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE milestones (
        id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        milestoneId TEXT DEFAULT NULL REFERENCES milestones(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT NULL,
        prompt TEXT DEFAULT NULL,
        branch TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'backlog'
          CHECK (status IN ('backlog', 'todo', 'in_progress', 'done')),
        priority TEXT NOT NULL DEFAULT 'medium',
        taskNumber INTEGER NOT NULL DEFAULT 0,
        sortOrder REAL NOT NULL DEFAULT 0,
        inboxAt TEXT DEFAULT NULL,
        inProgressAt TEXT DEFAULT NULL,
        doneAt TEXT DEFAULT NULL,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE todos (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
        linkedTaskId TEXT DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL,
        sortOrder REAL NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL DEFAULT 'info', category TEXT NOT NULL DEFAULT 'server', message TEXT NOT NULL, details TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE github_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE project_github_mappings (projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, subPath TEXT NOT NULL DEFAULT '', githubAccountId TEXT NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE, PRIMARY KEY (projectId, subPath));
    `);

    // Mark migrations 1-7 as done — tasks has NO approvedAt
    for (let v = 1; v <= 7; v++) {
      db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(v, `migration-${v}`);
    }

    db.exec("PRAGMA foreign_keys = ON");

    // Confirm tasks has no approvedAt column and no 'approved' in SQL
    const colsBefore = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(colsBefore.some((c) => c.name === "approvedAt")).toBe(false);
    const sqlBefore =
      (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as any)
        ?.sql || "";
    expect(sqlBefore).not.toContain("'approved'");

    _runMigrations(db);

    // After migration 8 the table should now include 'approved'
    const sqlAfter =
      (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as any)
        ?.sql || "";
    expect(sqlAfter).toContain("'approved'");
  });
});

// ---------------------------------------------------------------------------
// Migrations 10-12: cover the "column/table does not exist" exec paths.
// Build a custom old-style schema at v9 that lacks treeDepth, aiInstructions,
// and task_ai_runs.
// ---------------------------------------------------------------------------

// Old schema at v9: projects without treeDepth/aiInstructions, milestones without aiInstructions
const OLD_SCHEMA_V9 = `
CREATE TABLE _migrations (
  version   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  appliedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  path         TEXT NOT NULL UNIQUE,
  favorite     INTEGER NOT NULL DEFAULT 0,
  category     TEXT DEFAULT NULL,
  techStack    TEXT NOT NULL DEFAULT '[]',
  externalLinks TEXT NOT NULL DEFAULT '[]',
  aiCommitMode TEXT NOT NULL DEFAULT 'stage'
    CHECK (aiCommitMode IN ('commit', 'stage', 'none')),
  notionDatabaseId TEXT DEFAULT NULL,
  createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE milestones (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  sortOrder REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestoneId  TEXT DEFAULT NULL REFERENCES milestones(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT DEFAULT NULL,
  prompt       TEXT DEFAULT NULL,
  branch       TEXT DEFAULT NULL,
  promptProfile TEXT NOT NULL DEFAULT 'auto'
    CHECK (promptProfile IN ('auto', 'quick-fix', 'feature', 'refactor', 'bug-fix', 'docs')),
  status       TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'todo', 'in_progress', 'done', 'approved')),
  priority     TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  taskNumber   INTEGER NOT NULL DEFAULT 0,
  sortOrder    REAL NOT NULL DEFAULT 0,
  inboxAt      TEXT DEFAULT NULL,
  inProgressAt TEXT DEFAULT NULL,
  doneAt       TEXT DEFAULT NULL,
  approvedAt   TEXT DEFAULT NULL,
  createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_tasks_projectId_status ON tasks (projectId, status);
CREATE INDEX idx_tasks_projectId_status_sortOrder ON tasks (projectId, status, sortOrder);
CREATE INDEX idx_tasks_projectId_milestoneId ON tasks (projectId, milestoneId);
CREATE INDEX idx_tasks_doneAt ON tasks (doneAt);
CREATE INDEX idx_tasks_projectId_priority ON tasks (projectId, priority);
CREATE TABLE todos (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
  linkedTaskId TEXT DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL,
  sortOrder REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
CREATE TABLE system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL DEFAULT 'info', category TEXT NOT NULL DEFAULT 'server', message TEXT NOT NULL, details TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
CREATE TABLE github_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
CREATE TABLE project_github_mappings (projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, subPath TEXT NOT NULL DEFAULT '', githubAccountId TEXT NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE, PRIMARY KEY (projectId, subPath));
CREATE TABLE api_collections (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sortOrder REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE api_requests (
  id TEXT PRIMARY KEY, collectionId TEXT NOT NULL REFERENCES api_collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'GET', url TEXT NOT NULL DEFAULT '',
  headers TEXT NOT NULL DEFAULT '{}', body TEXT NOT NULL DEFAULT '',
  sortOrder REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

describe("migrations 10-12 on a DB stopped at v9", () => {
  test("migration 10 adds treeDepth, 11 adds aiInstructions, 12 creates task_ai_runs", () => {
    const db = freshDb("manual-v9");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    // Apply the old-v9 schema (no treeDepth, no aiInstructions, no task_ai_runs)
    db.exec(OLD_SCHEMA_V9);

    // Record migrations 1-9 as already applied
    const migNames = [
      "initial-schema",
      "add-task-number",
      "add-notion-database-id",
      "add-todos-table",
      "add-task-branch",
      "add-api-client-tables",
      "add-approved-status",
      "rebuild-tasks-check-constraint",
      "add-prompt-profile",
    ];
    for (let v = 1; v <= 9; v++) {
      db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(v, migNames[v - 1]);
    }

    // Confirm the columns/tables are absent
    const projCols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    expect(projCols.some((c) => c.name === "treeDepth")).toBe(false);
    expect(projCols.some((c) => c.name === "aiInstructions")).toBe(false);
    const msCols = db.prepare("PRAGMA table_info(milestones)").all() as { name: string }[];
    expect(msCols.some((c) => c.name === "aiInstructions")).toBe(false);
    const aiRunsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_ai_runs'")
      .get();
    expect(aiRunsTable).toBeNull();

    // Run migrations — should apply 10, 11, 12 and beyond
    _runMigrations(db);

    const projColsAfter = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    expect(projColsAfter.some((c) => c.name === "treeDepth")).toBe(true);
    expect(projColsAfter.some((c) => c.name === "aiInstructions")).toBe(true);
    const msColsAfter = db.prepare("PRAGMA table_info(milestones)").all() as { name: string }[];
    expect(msColsAfter.some((c) => c.name === "aiInstructions")).toBe(true);
    const aiRunsTableAfter = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_ai_runs'")
      .get();
    expect(aiRunsTableAfter).toBeTruthy();

    const max = (db.prepare("SELECT MAX(version) as v FROM _migrations").get() as { v: number }).v;
    expect(max).toBe(38);
  });
});

// ---------------------------------------------------------------------------
// Migration column-exists idempotency: confirm skipping when columns/tables exist
// NOTE: The migration runner uses MAX(version) as currentVersion, so to force
// re-running individual migrations we must delete ALL higher versions too.
// ---------------------------------------------------------------------------

describe("migration column-exists idempotency paths", () => {
  test("migration 2 skips ALTER when taskNumber already exists (run from v1)", () => {
    const db = freshDb("m2-idempotent");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    // Build a v1 schema via SCHEMA_SQL (already includes taskNumber), record only v1
    db.exec(SCHEMA_SQL);
    db.prepare("INSERT INTO _migrations (version, name) VALUES (1, 'initial-schema')").run();
    // currentVersion = 1, so migration 2 will run and see taskNumber exists — skip ALTER

    expect(() => _runMigrations(db)).not.toThrow();

    const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "taskNumber")).toBe(true);
    const v2 = db.prepare("SELECT version FROM _migrations WHERE version = 2").get();
    expect(v2).toBeTruthy();
  });

  test("migration 3 skips ALTER when notionDatabaseId already exists (run from v2)", () => {
    const db = freshDb("m3-idempotent");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    db.exec(SCHEMA_SQL);
    // Record v1 and v2, so currentVersion=2, migration 3 runs next
    db.prepare("INSERT INTO _migrations (version, name) VALUES (1, 'initial-schema')").run();
    db.prepare("INSERT INTO _migrations (version, name) VALUES (2, 'add-task-number')").run();

    expect(() => _runMigrations(db)).not.toThrow();
    const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "notionDatabaseId")).toBe(true);
    const v3 = db.prepare("SELECT version FROM _migrations WHERE version = 3").get();
    expect(v3).toBeTruthy();
  });

  test("migration 4 skips CREATE TABLE todos when it already exists (run from v3)", () => {
    const db = freshDb("m4-idempotent");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    db.exec(SCHEMA_SQL);
    for (let v = 1; v <= 3; v++) {
      db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(v, `v${v}`);
    }
    // currentVersion=3, migration 4 runs and sees todos table exists — skip

    expect(() => _runMigrations(db)).not.toThrow();
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='todos'")
      .get();
    expect(table).toBeTruthy();
    const v4 = db.prepare("SELECT version FROM _migrations WHERE version = 4").get();
    expect(v4).toBeTruthy();
  });

  test("migration 5 skips ALTER when branch column already exists (run from v4)", () => {
    const db = freshDb("m5-idempotent");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    db.exec(SCHEMA_SQL);
    for (let v = 1; v <= 4; v++) {
      db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(v, `v${v}`);
    }

    expect(() => _runMigrations(db)).not.toThrow();
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "branch")).toBe(true);
    const v5 = db.prepare("SELECT version FROM _migrations WHERE version = 5").get();
    expect(v5).toBeTruthy();
  });

  test("migration 7 skips approvedAt ALTER when column already exists (run from v6)", () => {
    const db = freshDb("m7-idempotent");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    db.exec(SCHEMA_SQL);
    for (let v = 1; v <= 6; v++) {
      db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(v, `v${v}`);
    }
    // currentVersion=6, migration 7 runs: sees approvedAt exists, skips ALTER; still rebuilds table

    expect(() => _runMigrations(db)).not.toThrow();
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "approvedAt")).toBe(true);
    const v7 = db.prepare("SELECT version FROM _migrations WHERE version = 7").get();
    expect(v7).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// "Column does not exist" paths in migrations 2, 3, 4, 5, 7
// (lines 62, 80, 92, 115, 170)
// These only run when a column is absent from an old-style schema.
// We use OLD_TASKS_SCHEMA_SQL which predates those columns.
// ---------------------------------------------------------------------------

describe("migration ALTER TABLE exec when column is absent", () => {
  test("migration 2 ALTERs tasks to add taskNumber when column is missing", () => {
    const db = freshDb("m2-alter-missing");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    // Use OLD_TASKS_SCHEMA_SQL which has taskNumber in tasks
    // We need a schema WITHOUT taskNumber. Build minimal schema manually.
    db.exec(`
      CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, favorite INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE milestones (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        milestoneId TEXT DEFAULT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT NULL,
        prompt TEXT DEFAULT NULL,
        branch TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'backlog',
        priority TEXT NOT NULL DEFAULT 'medium',
        sortOrder REAL NOT NULL DEFAULT 0,
        inboxAt TEXT DEFAULT NULL,
        inProgressAt TEXT DEFAULT NULL,
        doneAt TEXT DEFAULT NULL,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL DEFAULT 'info', category TEXT NOT NULL DEFAULT 'server', message TEXT NOT NULL, details TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE github_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE project_github_mappings (projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, subPath TEXT NOT NULL DEFAULT '', githubAccountId TEXT NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE, PRIMARY KEY (projectId, subPath));
    `);
    db.prepare("INSERT INTO _migrations (version, name) VALUES (1, 'initial-schema')").run();

    // Verify taskNumber is absent
    const colsBefore = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(colsBefore.some((c) => c.name === "taskNumber")).toBe(false);

    // Run migrations from v1 — migration 2 should ADD taskNumber
    _runMigrations(db);

    const colsAfter = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(colsAfter.some((c) => c.name === "taskNumber")).toBe(true);
  });

  test("migration 3 ALTERs projects to add notionDatabaseId when column is missing", () => {
    const db = freshDb("m3-alter-missing");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    // Minimal schema at v2: tasks has taskNumber + timestamp cols but projects has NO notionDatabaseId
    // Include inboxAt/inProgressAt/doneAt so migration 7's INSERT doesn't fail
    db.exec(`
      CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, favorite INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE milestones (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE tasks (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, milestoneId TEXT DEFAULT NULL, title TEXT NOT NULL, description TEXT DEFAULT NULL, prompt TEXT DEFAULT NULL, status TEXT NOT NULL DEFAULT 'backlog', priority TEXT NOT NULL DEFAULT 'medium', taskNumber INTEGER NOT NULL DEFAULT 0, sortOrder REAL NOT NULL DEFAULT 0, inboxAt TEXT DEFAULT NULL, inProgressAt TEXT DEFAULT NULL, doneAt TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL DEFAULT 'info', category TEXT NOT NULL DEFAULT 'server', message TEXT NOT NULL, details TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE github_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE project_github_mappings (projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, subPath TEXT NOT NULL DEFAULT '', githubAccountId TEXT NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE, PRIMARY KEY (projectId, subPath));
    `);
    db.prepare("INSERT INTO _migrations (version, name) VALUES (1, 'initial-schema')").run();
    db.prepare("INSERT INTO _migrations (version, name) VALUES (2, 'add-task-number')").run();

    const projColsBefore = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    expect(projColsBefore.some((c) => c.name === "notionDatabaseId")).toBe(false);

    _runMigrations(db);

    const projColsAfter = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    expect(projColsAfter.some((c) => c.name === "notionDatabaseId")).toBe(true);
  });

  test("migration 4 creates todos table when it is missing", () => {
    const db = freshDb("m4-create-todos");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    // v3 schema: no todos table; include inboxAt/inProgressAt/doneAt for migration 7 compatibility
    db.exec(`
      CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, favorite INTEGER NOT NULL DEFAULT 0, notionDatabaseId TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE milestones (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE tasks (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, milestoneId TEXT DEFAULT NULL, title TEXT NOT NULL, description TEXT DEFAULT NULL, prompt TEXT DEFAULT NULL, status TEXT NOT NULL DEFAULT 'backlog', priority TEXT NOT NULL DEFAULT 'medium', taskNumber INTEGER NOT NULL DEFAULT 0, sortOrder REAL NOT NULL DEFAULT 0, inboxAt TEXT DEFAULT NULL, inProgressAt TEXT DEFAULT NULL, doneAt TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL DEFAULT 'info', category TEXT NOT NULL DEFAULT 'server', message TEXT NOT NULL, details TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE github_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE project_github_mappings (projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, subPath TEXT NOT NULL DEFAULT '', githubAccountId TEXT NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE, PRIMARY KEY (projectId, subPath));
    `);
    for (let v = 1; v <= 3; v++) {
      db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(v, `v${v}`);
    }

    const todosTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='todos'")
      .get();
    expect(todosTable).toBeNull();

    _runMigrations(db);

    const todosTableAfter = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='todos'")
      .get();
    expect(todosTableAfter).toBeTruthy();
  });

  test("migration 5 ALTERs tasks to add branch when column is missing", () => {
    const db = freshDb("m5-alter-missing");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    // v4 schema: todos exists but tasks has no branch column
    db.exec(`
      CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, favorite INTEGER NOT NULL DEFAULT 0, notionDatabaseId TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE milestones (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE tasks (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, milestoneId TEXT DEFAULT NULL REFERENCES milestones(id) ON DELETE SET NULL, title TEXT NOT NULL, description TEXT DEFAULT NULL, prompt TEXT DEFAULT NULL, status TEXT NOT NULL DEFAULT 'backlog', priority TEXT NOT NULL DEFAULT 'medium', taskNumber INTEGER NOT NULL DEFAULT 0, sortOrder REAL NOT NULL DEFAULT 0, inboxAt TEXT DEFAULT NULL, inProgressAt TEXT DEFAULT NULL, doneAt TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, linkedTaskId TEXT DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL, sortOrder REAL NOT NULL DEFAULT 0, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL DEFAULT 'info', category TEXT NOT NULL DEFAULT 'server', message TEXT NOT NULL, details TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE github_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE project_github_mappings (projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, subPath TEXT NOT NULL DEFAULT '', githubAccountId TEXT NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE, PRIMARY KEY (projectId, subPath));
    `);
    for (let v = 1; v <= 4; v++) {
      db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(v, `v${v}`);
    }

    const colsBefore = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(colsBefore.some((c) => c.name === "branch")).toBe(false);

    _runMigrations(db);

    const colsAfter = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(colsAfter.some((c) => c.name === "branch")).toBe(true);
  });

  test("migration 7 ALTERs tasks to add approvedAt when column is missing", () => {
    const db = freshDb("m7-alter-missing");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    // v6 schema: has branch but NOT approvedAt (simulates a DB at v6 that truly lacked it)
    db.exec(`
      CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, favorite INTEGER NOT NULL DEFAULT 0, notionDatabaseId TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE milestones (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE tasks (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, milestoneId TEXT DEFAULT NULL REFERENCES milestones(id) ON DELETE SET NULL, title TEXT NOT NULL, description TEXT DEFAULT NULL, prompt TEXT DEFAULT NULL, branch TEXT DEFAULT NULL, status TEXT NOT NULL DEFAULT 'backlog', priority TEXT NOT NULL DEFAULT 'medium', taskNumber INTEGER NOT NULL DEFAULT 0, sortOrder REAL NOT NULL DEFAULT 0, inboxAt TEXT DEFAULT NULL, inProgressAt TEXT DEFAULT NULL, doneAt TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, linkedTaskId TEXT DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL, sortOrder REAL NOT NULL DEFAULT 0, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL DEFAULT 'info', category TEXT NOT NULL DEFAULT 'server', message TEXT NOT NULL, details TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE github_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE project_github_mappings (projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, subPath TEXT NOT NULL DEFAULT '', githubAccountId TEXT NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE, PRIMARY KEY (projectId, subPath));
      CREATE TABLE api_collections (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, sortOrder REAL NOT NULL DEFAULT 0, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
      CREATE TABLE api_requests (id TEXT PRIMARY KEY, collectionId TEXT NOT NULL REFERENCES api_collections(id) ON DELETE CASCADE, name TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'GET', url TEXT NOT NULL DEFAULT '', headers TEXT NOT NULL DEFAULT '{}', body TEXT NOT NULL DEFAULT '', sortOrder REAL NOT NULL DEFAULT 0, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
    `);
    for (let v = 1; v <= 6; v++) {
      db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(v, `v${v}`);
    }

    const colsBefore = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(colsBefore.some((c) => c.name === "approvedAt")).toBe(false);

    _runMigrations(db);

    const colsAfter = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(colsAfter.some((c) => c.name === "approvedAt")).toBe(true);
  });
});
