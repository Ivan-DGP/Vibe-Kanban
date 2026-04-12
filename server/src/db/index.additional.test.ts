import { describe, test, expect, afterAll } from "bun:test";
import crypto from "node:crypto";
import { getDb } from "./index";

// ─── getDb initialization ─────────────────────────────────────────────────────

describe("getDb initializes the database correctly", () => {
  test("returns a database handle with all expected methods", () => {
    const db = getDb();
    expect(typeof db.prepare).toBe("function");
    expect(typeof db.query).toBe("function");
    expect(typeof db.exec).toBe("function");
    expect(typeof db.transaction).toBe("function");
    expect(typeof db.close).toBe("function");
  });

  test("core tables exist after getDb()", () => {
    const db = getDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    const requiredTables = [
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
    ];

    for (const name of requiredTables) {
      expect(tableNames).toContain(name);
    }
  });
});

// ─── Migration versions are sequential ────────────────────────────────────────

describe("migration versions are sequential in the DB", () => {
  test("all recorded migrations have sequential version numbers starting from 1", () => {
    const db = getDb();
    const rows = db
      .prepare("SELECT version FROM _migrations ORDER BY version")
      .all() as { version: number }[];

    expect(rows.length).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].version).toBe(i + 1);
    }
  });

  test("the highest migration version matches the count of migrations", () => {
    const db = getDb();
    const maxResult = db
      .prepare("SELECT MAX(version) AS v FROM _migrations")
      .get() as { v: number };
    const countResult = db
      .prepare("SELECT COUNT(*) AS c FROM _migrations")
      .get() as { c: number };

    expect(maxResult.v).toBe(countResult.c);
  });
});

// ─── Idempotent migration runner ──────────────────────────────────────────────

describe("migration runner is idempotent", () => {
  test("calling getDb() twice does not re-run migrations (same count)", () => {
    const db1 = getDb();
    const countBefore = (
      db1
        .prepare("SELECT COUNT(*) AS c FROM _migrations")
        .get() as { c: number }
    ).c;

    // Call getDb again (returns same singleton, no migrations re-run)
    const db2 = getDb();
    const countAfter = (
      db2
        .prepare("SELECT COUNT(*) AS c FROM _migrations")
        .get() as { c: number }
    ).c;

    expect(countBefore).toBe(countAfter);
  });

  test("getDb() always returns the same migration count", () => {
    const db = getDb();
    const countA = (
      db
        .prepare("SELECT COUNT(*) AS c FROM _migrations")
        .get() as { c: number }
    ).c;

    // Call again — singleton, same result
    const db2 = getDb();
    const countB = (
      db2
        .prepare("SELECT COUNT(*) AS c FROM _migrations")
        .get() as { c: number }
    ).c;

    expect(countA).toBe(countB);
  });
});

// ─── Transaction support ──────────────────────────────────────────────────────

describe("transaction support", () => {
  const uniqueKey = `tx-test-${crypto.randomUUID()}`;

  afterAll(() => {
    // Clean up
    const db = getDb();
    try {
      db.prepare("DELETE FROM settings WHERE key LIKE 'tx-test-%'").run();
    } catch {
      // ignore if already cleaned
    }
  });

  test("successful transaction commits data", () => {
    const db = getDb();

    const txn = db.transaction(() => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
        uniqueKey,
        "committed-value",
      );
    });
    txn();

    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(uniqueKey) as { value: string } | null;
    expect(row).toBeTruthy();
    expect(row!.value).toBe("committed-value");
  });

  test("transaction rollback on error does not persist data", () => {
    const db = getDb();
    const rollbackKey = `tx-test-rollback-${crypto.randomUUID()}`;

    const txn = db.transaction(() => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
        rollbackKey,
        "should-not-exist",
      );
      // Force an error to trigger rollback
      throw new Error("intentional rollback");
    });

    expect(() => txn()).toThrow("intentional rollback");

    // Verify the row was NOT persisted
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(rollbackKey);
    expect(row).toBeFalsy();
  });

  test("transaction with multiple inserts commits all or nothing", () => {
    const db = getDb();
    const key1 = `tx-test-multi-1-${crypto.randomUUID()}`;
    const key2 = `tx-test-multi-2-${crypto.randomUUID()}`;

    const txn = db.transaction(() => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
        key1,
        "value-1",
      );
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
        key2,
        "value-2",
      );
    });
    txn();

    const row1 = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key1) as { value: string } | null;
    const row2 = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key2) as { value: string } | null;

    expect(row1).toBeTruthy();
    expect(row1!.value).toBe("value-1");
    expect(row2).toBeTruthy();
    expect(row2!.value).toBe("value-2");

    // Clean up
    db.prepare("DELETE FROM settings WHERE key IN (?, ?)").run(key1, key2);
  });
});
