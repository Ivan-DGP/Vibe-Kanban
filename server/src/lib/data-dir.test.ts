import { describe, test, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// We test the logic of data-dir by importing the module.
// Note: the module uses import.meta.dir which resolves to the source directory,
// so getDataDir() returns a path relative to where the module lives.

import { getDataDir, getDbPath, getTaskSnapshotDir, getProjectArtifactsDir } from "./data-dir";

describe("data-dir", () => {
  test("getDataDir returns a path ending in /data", () => {
    const dir = getDataDir();
    expect(dir.endsWith("/data") || dir.endsWith("\\data")).toBe(true);
  });

  test("getDataDir creates the directory if missing", () => {
    const dir = getDataDir();
    expect(fs.existsSync(dir)).toBe(true);
  });

  test("getDataDir creates the directory when it does not exist", () => {
    const dir = getDataDir();
    const tmpName = dir + "__missing_test__";
    // Self-heal if a prior crashed run left tmpName behind
    if (fs.existsSync(tmpName)) {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmpName, dir);
    }
    fs.renameSync(dir, tmpName);
    try {
      expect(fs.existsSync(dir)).toBe(false);
      const result = getDataDir();
      expect(result).toBe(dir);
      expect(fs.existsSync(dir)).toBe(true);
    } finally {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmpName, dir);
    }
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

  test("getProjectArtifactsDir returns path containing project ID", () => {
    const testId = "test-project-123";
    const dir = getProjectArtifactsDir(testId);
    expect(dir).toContain(testId);
    expect(dir.endsWith("/artifacts") || dir.endsWith("\\artifacts")).toBe(true);
  });

  test("getProjectArtifactsDir creates the directory", () => {
    const testId = `test-project-${Date.now()}`;
    const dir = getProjectArtifactsDir(testId);
    expect(fs.existsSync(dir)).toBe(true);
    // Clean up
    fs.rmSync(dir, { recursive: true });
    fs.rmSync(path.dirname(dir), { recursive: true });
  });

  test("getProjectArtifactsDir is inside data dir", () => {
    const dataDir = getDataDir();
    const dir = getProjectArtifactsDir("check-parent");
    expect(dir.startsWith(dataDir)).toBe(true);
    // Clean up
    fs.rmSync(path.resolve(dataDir, "projects", "check-parent"), { recursive: true });
  });

  test("getTaskSnapshotDir creates directory when it does not exist", () => {
    const dataDir = getDataDir();
    const tasksDir = path.join(dataDir, "tasks");
    const tmpName = tasksDir + "__missing_snap_test__";
    // Self-heal if a prior crashed run left tmpName behind
    if (fs.existsSync(tmpName)) {
      if (fs.existsSync(tasksDir))
        fs.rmSync(tasksDir, { recursive: true, force: true });
      fs.renameSync(tmpName, tasksDir);
    }
    fs.renameSync(tasksDir, tmpName);
    try {
      expect(fs.existsSync(tasksDir)).toBe(false);
      const result = getTaskSnapshotDir();
      expect(result).toBe(tasksDir);
      expect(fs.existsSync(tasksDir)).toBe(true);
    } finally {
      if (fs.existsSync(tasksDir))
        fs.rmSync(tasksDir, { recursive: true, force: true });
      fs.renameSync(tmpName, tasksDir);
    }
  });
});
