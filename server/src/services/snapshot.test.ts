import { describe, test, expect, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "../db";
import { getTaskSnapshotDir } from "../lib/data-dir";
import { writeTaskSnapshot } from "./snapshot";

const db = getDb();
const snapshotDir = getTaskSnapshotDir();

// Generate unique IDs for test isolation
const PROJECT_ID = crypto.randomUUID();
const TASK_ID_1 = crypto.randomUUID();
const TASK_ID_2 = crypto.randomUUID();
const MILESTONE_ID = crypto.randomUUID();
const TASK_ID_WITH_MILESTONE = crypto.randomUUID();

// Insert test project and tasks
db.prepare(
  "INSERT INTO projects (id, name, path) VALUES (?, ?, ?)",
).run(PROJECT_ID, "Snapshot Test Project", `/tmp/test-snapshot-${PROJECT_ID}`);

db.prepare(
  `INSERT INTO tasks (id, projectId, title, status, priority, sortOrder, taskNumber)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
).run(TASK_ID_1, PROJECT_ID, "Task Alpha", "backlog", "high", 1, 1);

db.prepare(
  `INSERT INTO tasks (id, projectId, title, status, priority, sortOrder, taskNumber)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
).run(TASK_ID_2, PROJECT_ID, "Task Beta", "in_progress", "medium", 2, 2);

// Insert a milestone and a task with that milestone
db.prepare(
  "INSERT INTO milestones (id, projectId, name) VALUES (?, ?, ?)",
).run(MILESTONE_ID, PROJECT_ID, "v1.0 Release");

db.prepare(
  `INSERT INTO tasks (id, projectId, milestoneId, title, status, priority, sortOrder, taskNumber)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
).run(TASK_ID_WITH_MILESTONE, PROJECT_ID, MILESTONE_ID, "Task Gamma", "todo", "low", 3, 3);

afterAll(() => {
  // Clean up test data
  db.prepare("DELETE FROM tasks WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM milestones WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM projects WHERE id = ?").run(PROJECT_ID);

  // Clean up snapshot file
  const filePath = path.join(snapshotDir, `${PROJECT_ID}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  const tmpPath = filePath + ".tmp";
  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }
});

/** Helper: wait for the snapshot file to appear (writeTaskSnapshot is async internally). */
async function waitForSnapshot(projectId: string, timeoutMs = 2000): Promise<string> {
  const filePath = path.join(snapshotDir, `${projectId}.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      // Also wait for the .tmp file to be gone (rename complete)
      const tmpPath = filePath + ".tmp";
      if (!fs.existsSync(tmpPath)) {
        return filePath;
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Snapshot file not created within ${timeoutMs}ms`);
}

describe("writeTaskSnapshot", () => {
  test("creates a JSON file in the snapshot directory", async () => {
    writeTaskSnapshot(PROJECT_ID);
    const filePath = await waitForSnapshot(PROJECT_ID);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toBe(path.join(snapshotDir, `${PROJECT_ID}.json`));
  });

  test("JSON file contains projectId, projectName, exportedAt, and tasks array", async () => {
    // The file should already exist from the previous test
    const filePath = path.join(snapshotDir, `${PROJECT_ID}.json`);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    expect(content.projectId).toBe(PROJECT_ID);
    expect(content.projectName).toBe("Snapshot Test Project");
    expect(content.exportedAt).toBeDefined();
    expect(typeof content.exportedAt).toBe("string");
    // exportedAt should be a valid ISO date
    expect(new Date(content.exportedAt).toISOString()).toBe(content.exportedAt);
    expect(Array.isArray(content.tasks)).toBe(true);
    expect(content.tasks.length).toBe(3);
  });

  test("tasks in the snapshot have the correct fields", async () => {
    const filePath = path.join(snapshotDir, `${PROJECT_ID}.json`);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    for (const task of content.tasks) {
      expect(task.id).toBeDefined();
      expect(task.projectId).toBe(PROJECT_ID);
      expect(task.title).toBeDefined();
      expect(task.status).toBeDefined();
      expect(task.priority).toBeDefined();
      expect(task.sortOrder).toBeDefined();
      expect(task.taskNumber).toBeDefined();
      expect(task.createdAt).toBeDefined();
      expect(task.updatedAt).toBeDefined();
      // milestoneName should always be present (defaulted to "General")
      expect(task.milestoneName).toBeDefined();
    }

    // Verify specific tasks
    const taskAlpha = content.tasks.find((t: any) => t.id === TASK_ID_1);
    expect(taskAlpha).toBeTruthy();
    expect(taskAlpha.title).toBe("Task Alpha");
    expect(taskAlpha.status).toBe("backlog");
    expect(taskAlpha.priority).toBe("high");

    const taskBeta = content.tasks.find((t: any) => t.id === TASK_ID_2);
    expect(taskBeta).toBeTruthy();
    expect(taskBeta.title).toBe("Task Beta");
    expect(taskBeta.status).toBe("in_progress");
  });

  test("snapshot includes milestoneName, defaults to 'General' when no milestone", async () => {
    const filePath = path.join(snapshotDir, `${PROJECT_ID}.json`);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    // Tasks without a milestone should have milestoneName "General"
    const taskAlpha = content.tasks.find((t: any) => t.id === TASK_ID_1);
    expect(taskAlpha.milestoneName).toBe("General");

    const taskBeta = content.tasks.find((t: any) => t.id === TASK_ID_2);
    expect(taskBeta.milestoneName).toBe("General");

    // Task with a milestone should have the real milestone name
    const taskGamma = content.tasks.find((t: any) => t.id === TASK_ID_WITH_MILESTONE);
    expect(taskGamma.milestoneName).toBe("v1.0 Release");
  });

  test("calling writeTaskSnapshot twice overwrites the previous file", async () => {
    // Read the current snapshot's exportedAt
    const filePath = path.join(snapshotDir, `${PROJECT_ID}.json`);
    const firstContent = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const firstExportedAt = firstContent.exportedAt;

    // Small delay to ensure a different timestamp
    await new Promise((r) => setTimeout(r, 50));

    // Write again
    writeTaskSnapshot(PROJECT_ID);
    await waitForSnapshot(PROJECT_ID);

    // Give it a moment for the rename to complete
    await new Promise((r) => setTimeout(r, 100));

    const secondContent = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const secondExportedAt = secondContent.exportedAt;

    // The exportedAt should be different (newer)
    expect(secondExportedAt).not.toBe(firstExportedAt);
    expect(new Date(secondExportedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(firstExportedAt).getTime(),
    );

    // The data should still be correct
    expect(secondContent.projectId).toBe(PROJECT_ID);
    expect(secondContent.tasks.length).toBe(3);
  });
});
