import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "../db";
import { buildSpawnOpts } from "./taskSpawner";

/**
 * buildSpawnOpts is shared by the retry loop and the resume scheduler. The fallback
 * path (no registered spawn config) is what lets an interactive AI-resolve task be
 * resumed headlessly, so it needs explicit coverage.
 */
describe("buildSpawnOpts", () => {
  const db = getDb();
  const projectId = crypto.randomUUID();
  const noTypeTaskId = crypto.randomUUID();
  const missingPathProjectId = crypto.randomUUID();
  const missingPathTaskId = crypto.randomUUID();
  let projDir: string;

  beforeAll(() => {
    projDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-bso-"));
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      projectId,
      "bso",
      projDir,
    );
    db.prepare(
      "INSERT INTO tasks (id, projectId, title, description, metadata) VALUES (?, ?, ?, ?, ?)",
    ).run(
      noTypeTaskId,
      projectId,
      "Resolve me",
      "needs work",
      "{}", // no metadata.type → no registered config
    );
    // Project whose path does not exist on disk.
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      missingPathProjectId,
      "gone",
      "/tmp/vk-does-not-exist-" + missingPathProjectId,
    );
    db.prepare("INSERT INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
      missingPathTaskId,
      missingPathProjectId,
      "orphan",
    );
  });

  afterAll(() => {
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    db.prepare("DELETE FROM projects WHERE id = ?").run(missingPathProjectId);
    try {
      fs.rmSync(projDir, { recursive: true, force: true });
    } catch {}
  });

  test("falls back to a generic resolve config when the task has no registered type", async () => {
    const runId = crypto.randomUUID();
    const opts = await buildSpawnOpts(noTypeTaskId, runId);
    expect(opts).not.toBeNull();
    expect(opts!.profile).toBe("resolve");
    expect(opts!.cwd).toBe(projDir);
    expect(opts!.taskId).toBe(noTypeTaskId);
    // Prompt derived from task fields when there's no buildPrompt.
    expect(opts!.prompt).toContain("Resolve me");
    expect(typeof opts!.mcpConfigPath).toBe("string");
    // MCP config file was actually written; cleanup removes it.
    expect(fs.existsSync(opts!.mcpConfigPath)).toBe(true);
    opts!.cleanup();
    expect(fs.existsSync(opts!.mcpConfigPath)).toBe(false);
  });

  test("returns null for an unknown task", async () => {
    expect(await buildSpawnOpts("does-not-exist", crypto.randomUUID())).toBeNull();
  });

  test("returns null when the project path is missing on disk", async () => {
    expect(await buildSpawnOpts(missingPathTaskId, crypto.randomUUID())).toBeNull();
  });
});
