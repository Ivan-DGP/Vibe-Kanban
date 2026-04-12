import { describe, test, expect, afterAll } from "bun:test";
import crypto from "node:crypto";
import { getDb } from "./index";

const db = getDb();

// Unique key for test isolation in settings table
const TEST_SETTINGS_KEY = `test-key-${crypto.randomUUID()}`;

afterAll(() => {
  // Clean up test data
  db.prepare("DELETE FROM settings WHERE key = ?").run(TEST_SETTINGS_KEY);
});

describe("getDb", () => {
  test("returns a database handle with prepare, query, exec, transaction, close methods", () => {
    expect(typeof db.prepare).toBe("function");
    expect(typeof db.query).toBe("function");
    expect(typeof db.exec).toBe("function");
    expect(typeof db.transaction).toBe("function");
    expect(typeof db.close).toBe("function");
  });

  test("returns the same instance on repeated calls (singleton)", () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });
});

describe("database schema", () => {
  test("has the expected tables", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    const expectedTables = [
      "projects",
      "tasks",
      "milestones",
      "settings",
      "system_logs",
      "todos",
      "github_accounts",
      "project_github_mappings",
      "task_ai_runs",
      "_migrations",
    ];

    for (const expected of expectedTables) {
      expect(tableNames).toContain(expected);
    }
  });

  test("the _migrations table has entries (at least version 1)", () => {
    const rows = db
      .prepare("SELECT version, name FROM _migrations ORDER BY version")
      .all() as { version: number; name: string }[];

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].name).toBe("initial-schema");
  });
});

describe("database pragmas", () => {
  test("foreign keys are enabled (PRAGMA foreign_keys returns 1)", () => {
    const result = db.prepare("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };
    expect(result.foreign_keys).toBe(1);
  });

  test("WAL mode is enabled (PRAGMA journal_mode returns 'wal')", () => {
    const result = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(result.journal_mode).toBe("wal");
  });
});

describe("basic CRUD on settings table", () => {
  test("insert into settings and read back", () => {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      TEST_SETTINGS_KEY,
      "test-value-42",
    );

    const row = db.prepare("SELECT * FROM settings WHERE key = ?").get(
      TEST_SETTINGS_KEY,
    ) as { key: string; value: string; updatedAt: string } | null;

    expect(row).toBeTruthy();
    expect(row!.key).toBe(TEST_SETTINGS_KEY);
    expect(row!.value).toBe("test-value-42");
    expect(row!.updatedAt).toBeDefined();
  });

  test("update a setting value", () => {
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(
      "updated-value-99",
      TEST_SETTINGS_KEY,
    );

    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(
      TEST_SETTINGS_KEY,
    ) as { value: string };

    expect(row.value).toBe("updated-value-99");
  });

  test("delete a setting", () => {
    db.prepare("DELETE FROM settings WHERE key = ?").run(TEST_SETTINGS_KEY);

    const row = db.prepare("SELECT * FROM settings WHERE key = ?").get(
      TEST_SETTINGS_KEY,
    );

    expect(row).toBeFalsy();
  });
});
