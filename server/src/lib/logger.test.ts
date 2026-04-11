import { describe, test, expect } from "bun:test";
import { getDb } from "../db";
import { log } from "./logger";

describe("logger", () => {
  test("log writes to system_logs table", () => {
    const db = getDb();
    const before = db
      .prepare("SELECT COUNT(*) as count FROM system_logs")
      .get() as { count: number };

    log("info", "server", "test log message", { key: "value" });

    const after = db
      .prepare("SELECT COUNT(*) as count FROM system_logs")
      .get() as { count: number };
    expect(after.count).toBeGreaterThan(before.count);
  });

  test("log persists level, category, message, and details", () => {
    const db = getDb();
    const uniqueMsg = `test-${Date.now()}-${Math.random()}`;
    log("warn", "git", uniqueMsg, { detail: "test" });

    const row = db
      .prepare("SELECT * FROM system_logs WHERE message = ?")
      .get(uniqueMsg) as { level: string; category: string; message: string; details: string };

    expect(row).toBeTruthy();
    expect(row.level).toBe("warn");
    expect(row.category).toBe("git");
    expect(row.message).toBe(uniqueMsg);
    expect(JSON.parse(row.details)).toEqual({ detail: "test" });
  });

  test("log works without details parameter", () => {
    const db = getDb();
    const uniqueMsg = `no-detail-${Date.now()}-${Math.random()}`;
    log("error", "tasks", uniqueMsg);

    const row = db
      .prepare("SELECT * FROM system_logs WHERE message = ?")
      .get(uniqueMsg) as { details: string | null };

    expect(row).toBeTruthy();
    expect(row.details).toBeNull();
  });
});
