import { describe, test, expect } from "bun:test";
import crypto from "node:crypto";
import { getDb } from "./index";

const db = getDb();

/**
 * The maximum migration version currently defined in index.ts.
 * Update this when new migrations are added.
 */
const MAX_MIGRATION_VERSION = 20;

describe("migration versions are recorded", () => {
  test("all migration versions from 1 to MAX exist in _migrations table", () => {
    const rows = db
      .prepare("SELECT version FROM _migrations ORDER BY version")
      .all() as { version: number }[];

    const versions = rows.map((r) => r.version);
    for (let v = 1; v <= MAX_MIGRATION_VERSION; v++) {
      expect(versions).toContain(v);
    }
  });
});

describe("migration names are descriptive", () => {
  test("each migration has a non-empty name", () => {
    const rows = db
      .prepare("SELECT version, name FROM _migrations ORDER BY version")
      .all() as { version: number; name: string }[];

    expect(rows.length).toBeGreaterThanOrEqual(MAX_MIGRATION_VERSION);
    for (const row of rows) {
      expect(row.name).toBeTruthy();
      expect(row.name.length).toBeGreaterThan(0);
    }
  });
});

describe("migration timestamps are valid", () => {
  test("each appliedAt is a valid ISO timestamp", () => {
    const rows = db
      .prepare("SELECT version, appliedAt FROM _migrations ORDER BY version")
      .all() as { version: number; appliedAt: string }[];

    for (const row of rows) {
      expect(row.appliedAt).toBeTruthy();
      const parsed = new Date(row.appliedAt);
      expect(parsed.getTime()).not.toBeNaN();
      // Verify it's a reasonable date (after 2024)
      expect(parsed.getFullYear()).toBeGreaterThanOrEqual(2024);
    }
  });
});

describe("migrations run in order", () => {
  test("versions are sequential (1, 2, 3, ...)", () => {
    const rows = db
      .prepare("SELECT version FROM _migrations ORDER BY version")
      .all() as { version: number }[];

    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].version).toBe(i + 1);
    }
  });
});

describe("schema has all expected columns on tasks", () => {
  const getTaskColumns = (): string[] => {
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as {
      name: string;
    }[];
    return cols.map((c) => c.name);
  };

  test("taskNumber column exists (added by migration 2)", () => {
    expect(getTaskColumns()).toContain("taskNumber");
  });

  test("parentTaskId column exists (added by migration 14)", () => {
    expect(getTaskColumns()).toContain("parentTaskId");
  });

  test("sortOrder column exists", () => {
    expect(getTaskColumns()).toContain("sortOrder");
  });

  test("promptProfile column exists (added by migration 9)", () => {
    expect(getTaskColumns()).toContain("promptProfile");
  });

  test("approvedAt column exists (added by migration 7)", () => {
    expect(getTaskColumns()).toContain("approvedAt");
  });

  test("archivedAt column exists (added by migration 13)", () => {
    expect(getTaskColumns()).toContain("archivedAt");
  });
});

describe("schema has all expected columns on projects", () => {
  const getProjectColumns = (): string[] => {
    const cols = db.prepare("PRAGMA table_info(projects)").all() as {
      name: string;
    }[];
    return cols.map((c) => c.name);
  };

  test("notionDatabaseId column exists (added by migration 3)", () => {
    expect(getProjectColumns()).toContain("notionDatabaseId");
  });

  test("treeDepth column exists (added by migration 10)", () => {
    expect(getProjectColumns()).toContain("treeDepth");
  });

  test("aiInstructions column exists (added by migration 11)", () => {
    expect(getProjectColumns()).toContain("aiInstructions");
  });
});

describe("index existence", () => {
  const getIndexNames = (): string[] => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all() as { name: string }[];
    return indexes.map((i) => i.name);
  };

  test("idx_tasks_projectId_status exists", () => {
    expect(getIndexNames()).toContain("idx_tasks_projectId_status");
  });

  test("idx_tasks_doneAt exists", () => {
    expect(getIndexNames()).toContain("idx_tasks_doneAt");
  });

  test("idx_tasks_projectId_priority exists", () => {
    expect(getIndexNames()).toContain("idx_tasks_projectId_priority");
  });
});

describe("task_ai_runs table exists with correct columns", () => {
  test("task_ai_runs table exists", () => {
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='task_ai_runs'",
      )
      .get() as { name: string } | null;
    expect(table).toBeTruthy();
  });

  test("task_ai_runs has all expected columns", () => {
    const cols = db.prepare("PRAGMA table_info(task_ai_runs)").all() as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);

    const expectedColumns = [
      "id",
      "taskId",
      "projectId",
      "sessionId",
      "profile",
      "complexity",
      "exitCode",
      "success",
      "filesChanged",
      "durationMs",
      "summary",
    ];

    for (const col of expectedColumns) {
      expect(colNames).toContain(col);
    }
  });
});

describe("todos table has expected columns", () => {
  test("todos table has all expected columns", () => {
    const cols = db.prepare("PRAGMA table_info(todos)").all() as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);

    const expectedColumns = [
      "id",
      "title",
      "completed",
      "linkedTaskId",
      "sortOrder",
    ];

    for (const col of expectedColumns) {
      expect(colNames).toContain(col);
    }
  });
});

describe("foreign key constraint works", () => {
  test("inserting a task with non-existent projectId should fail", () => {
    const fakeProjectId = `nonexistent-${crypto.randomUUID()}`;
    const fakeTaskId = `task-${crypto.randomUUID()}`;

    expect(() => {
      db.prepare(
        "INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)",
      ).run(fakeTaskId, fakeProjectId, "should fail");
    }).toThrow();
  });
});
