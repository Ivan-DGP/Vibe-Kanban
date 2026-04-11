import { describe, test, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// We test the logic of data-dir by importing the module.
// Note: the module uses import.meta.dir which resolves to the source directory,
// so getDataDir() returns a path relative to where the module lives.

import { getDataDir, getDbPath, getTaskSnapshotDir } from "./data-dir";

describe("data-dir", () => {
  test("getDataDir returns a path ending in /data", () => {
    const dir = getDataDir();
    expect(dir.endsWith("/data") || dir.endsWith("\\data")).toBe(true);
  });

  test("getDataDir creates the directory if missing", () => {
    const dir = getDataDir();
    expect(fs.existsSync(dir)).toBe(true);
  });

  test("getDbPath returns path ending in vibe-kanban.db", () => {
    const dbPath = getDbPath();
    expect(path.basename(dbPath)).toBe("vibe-kanban.db");
    expect(dbPath.startsWith(getDataDir())).toBe(true);
  });

  test("getTaskSnapshotDir returns path ending in /tasks", () => {
    const dir = getTaskSnapshotDir();
    expect(dir.endsWith("/tasks") || dir.endsWith("\\tasks")).toBe(true);
    expect(fs.existsSync(dir)).toBe(true);
  });

  test("getTaskSnapshotDir is inside data dir", () => {
    const dataDir = getDataDir();
    const snapDir = getTaskSnapshotDir();
    expect(snapDir.startsWith(dataDir)).toBe(true);
  });
});
