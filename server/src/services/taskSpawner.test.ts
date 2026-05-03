import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import crypto from "node:crypto";
import type { Task } from "@vibe-kanban/shared";
import { getDb } from "../db";
import { maybeSpawnForTask } from "./taskSpawner";
import {
  registerSpawnConfig,
  _resetSpawnRegistry,
} from "./taskSpawnRegistry";

const db = getDb();

let projectId: string;
let buildPromptCalled = 0;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `t-${crypto.randomUUID()}`,
    projectId,
    title: "Test task",
    description: null,
    prompt: null,
    branch: null,
    promptProfile: "auto",
    status: "backlog",
    priority: "medium",
    taskNumber: 1,
    sortOrder: 0,
    inboxAt: null,
    inProgressAt: null,
    doneAt: null,
    approvedAt: null,
    archivedAt: null,
    milestoneId: null,
    parentTaskId: null,
    notionPageId: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Task;
}

function insertProject(
  autoSpawnEnabled: 0 | 1,
  opts: { projectPath?: string } = {},
): string {
  const id = `proj-${crypto.randomUUID()}`;
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, path, techStack, externalLinks, favorite, autoSpawnEnabled, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    "spawner-test",
    opts.projectPath ?? `/tmp/${id}`,
    "[]",
    "[]",
    0,
    autoSpawnEnabled,
    ts,
    ts,
  );
  return id;
}

beforeEach(() => {
  buildPromptCalled = 0;
  _resetSpawnRegistry();
  registerSpawnConfig({
    type: "qa-test",
    mcpServers: ["vibe-kanban"],
    profile: "qa",
    buildPrompt: () => {
      buildPromptCalled++;
      return "should not run";
    },
  });
});

afterEach(() => {
  if (projectId) {
    db.prepare("DELETE FROM tasks WHERE projectId = ?").run(projectId);
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  }
  _resetSpawnRegistry();
});

describe("maybeSpawnForTask", () => {
  test("no-op when task.metadata has no type", async () => {
    projectId = insertProject(1);
    maybeSpawnForTask(makeTask({ metadata: {} }));
    await new Promise((r) => setTimeout(r, 50));
    expect(buildPromptCalled).toBe(0);
  });

  test("no-op when type is unregistered", async () => {
    projectId = insertProject(1);
    maybeSpawnForTask(makeTask({ metadata: { type: "no-such-type" } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(buildPromptCalled).toBe(0);
  });

  test("no-op when project.autoSpawnEnabled = 0", async () => {
    projectId = insertProject(0);
    maybeSpawnForTask(makeTask({ metadata: { type: "qa-test" } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(buildPromptCalled).toBe(0);
  });

  test("no-op when project does not exist", async () => {
    projectId = `nonexistent-${crypto.randomUUID()}`;
    maybeSpawnForTask(makeTask({ metadata: { type: "qa-test" } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(buildPromptCalled).toBe(0);
    projectId = ""; // skip cleanup
  });

  test("never throws synchronously", () => {
    expect(() => maybeSpawnForTask(makeTask())).not.toThrow();
    expect(() => maybeSpawnForTask(makeTask({ metadata: { type: "x" } }))).not.toThrow();
  });

  test("no-op when project.path does not exist on disk", async () => {
    projectId = insertProject(1, { projectPath: "/tmp/does-not-exist-anywhere-xyz" });
    maybeSpawnForTask(makeTask({ metadata: { type: "qa-test" } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(buildPromptCalled).toBe(0);
  });
});
