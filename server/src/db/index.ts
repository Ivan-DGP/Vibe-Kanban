import { openDatabase, type DatabaseHandle } from "../lib/runtime";
import { getDbPath } from "../lib/data-dir";
import { SCHEMA_SQL } from "./schema";

let _db: DatabaseHandle | null = null;

export function getDb(): DatabaseHandle {
  if (_db) return _db;

  const dbPath = getDbPath();
  _db = openDatabase(dbPath);

  // Set pragmas
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA busy_timeout = 5000");

  // Run initial schema
  runMigrations(_db);

  return _db;
}

function runMigrations(db: DatabaseHandle): void {
  // Check if _migrations table exists
  const migrationTableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'",
    )
    .get();

  if (!migrationTableExists) {
    // First run - create all tables
    db.exec(SCHEMA_SQL);
    db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(
      1,
      "initial-schema",
    );
    return;
  }

  // Check current version
  const current = db
    .prepare("SELECT MAX(version) as v FROM _migrations")
    .get() as { v: number } | null;
  const currentVersion = current?.v ?? 0;

  // Run any pending migrations
  const migrations: { version: number; name: string; up: () => void }[] = [
    {
      version: 1,
      name: "initial-schema",
      up: () => db.exec(SCHEMA_SQL),
    },
    {
      version: 2,
      name: "add-task-number",
      up: () => {
        // Add column if it doesn't exist
        const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "taskNumber")) {
          db.exec("ALTER TABLE tasks ADD COLUMN taskNumber INTEGER NOT NULL DEFAULT 0");
        }
        // Backfill: assign numbers per project ordered by createdAt
        const projects = db.prepare("SELECT DISTINCT projectId FROM tasks").all() as { projectId: string }[];
        for (const { projectId } of projects) {
          const tasks = db.prepare("SELECT id FROM tasks WHERE projectId = ? ORDER BY createdAt ASC").all(projectId) as { id: string }[];
          for (let i = 0; i < tasks.length; i++) {
            db.prepare("UPDATE tasks SET taskNumber = ? WHERE id = ?").run(i + 1, tasks[i].id);
          }
        }
      },
    },
    {
      version: 3,
      name: "add-notion-database-id",
      up: () => {
        const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "notionDatabaseId")) {
          db.exec("ALTER TABLE projects ADD COLUMN notionDatabaseId TEXT DEFAULT NULL");
        }
      },
    },
    {
      version: 4,
      name: "add-todos-table",
      up: () => {
        const tableExists = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='todos'")
          .get();
        if (!tableExists) {
          db.exec(`
            CREATE TABLE todos (
              id           TEXT PRIMARY KEY,
              title        TEXT NOT NULL,
              completed    INTEGER NOT NULL DEFAULT 0,
              linkedTaskId TEXT DEFAULT NULL
                REFERENCES tasks(id) ON DELETE SET NULL,
              sortOrder    REAL NOT NULL DEFAULT 0,
              createdAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
              updatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX idx_todos_completed ON todos (completed);
            CREATE INDEX idx_todos_sortOrder ON todos (sortOrder);
          `);
        }
      },
    },
    {
      version: 5,
      name: "add-task-branch",
      up: () => {
        const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
        if (!cols.some((c) => c.name === "branch")) {
          db.exec("ALTER TABLE tasks ADD COLUMN branch TEXT DEFAULT NULL");
        }
      },
    },
  ];

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      db.transaction(() => {
        migration.up();
        db.prepare(
          "INSERT INTO _migrations (version, name) VALUES (?, ?)",
        ).run(migration.version, migration.name);
      })();
    }
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
