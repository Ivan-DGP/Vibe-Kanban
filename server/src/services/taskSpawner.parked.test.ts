/**
 * A parked (usage-limit) headless run must short-circuit runSpawn's retry loop:
 * it's handed to the resume scheduler, NOT retried/failed. Verifies spawn is
 * invoked exactly once for a parked result (a non-parked failure would retry).
 */
import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Task } from "@vibe-kanban/shared";
import { getDb } from "../db";
import * as realHeadlessNs from "./headlessClaude";

const realHeadless = { ...realHeadlessNs };
let spawnCount = 0;

mock.module("./headlessClaude", () => ({
  ...realHeadless,
  hasRunningRun: () => false,
  spawnHeadlessClaude: mock(async (opts: { runId: string }) => {
    spawnCount++;
    return {
      exitCode: 1,
      summary: null,
      sessionId: "s",
      durationMs: 1,
      runId: opts.runId,
      parked: true,
    };
  }),
}));

import { maybeSpawnForTask } from "./taskSpawner";
import { registerSpawnConfig, _resetSpawnRegistry } from "./taskSpawnRegistry";

const db = getDb();
let projectId: string;
let projDir: string;

beforeAll(() => {
  projDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-parked-spawner-"));
  projectId = `proj-${crypto.randomUUID()}`;
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, path, techStack, externalLinks, favorite, autoSpawnEnabled, createdAt, updatedAt)
     VALUES (?, 'parked-spawner', ?, '[]', '[]', 0, 1, ?, ?)`,
  ).run(projectId, projDir, ts, ts);
  _resetSpawnRegistry();
  registerSpawnConfig({
    type: "qa-test",
    mcpServers: ["vibe-kanban"],
    profile: "qa",
    maxAttempts: 3,
    buildPrompt: () => "do it",
  });
});

afterAll(() => {
  mock.module("./headlessClaude", () => realHeadless);
  _resetSpawnRegistry();
  db.prepare("DELETE FROM tasks WHERE projectId = ?").run(projectId);
  db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  try {
    fs.rmSync(projDir, { recursive: true, force: true });
  } catch {}
});

describe("runSpawn parked handling", () => {
  test("a parked result is not retried (spawn invoked once despite maxAttempts=3)", async () => {
    spawnCount = 0;
    const task = {
      id: `t-${crypto.randomUUID()}`,
      projectId,
      title: "parked task",
      description: null,
      prompt: null,
      metadata: { type: "qa-test" },
      status: "backlog",
      priority: "medium",
    } as unknown as Task;
    db.prepare("INSERT INTO tasks (id, projectId, title, metadata) VALUES (?, ?, ?, ?)").run(
      task.id,
      projectId,
      task.title,
      JSON.stringify(task.metadata),
    );

    maybeSpawnForTask(task);
    await new Promise((r) => setTimeout(r, 200));

    // parked → returned immediately; NOT retried up to maxAttempts (which would be 3).
    expect(spawnCount).toBe(1);
  });
});
