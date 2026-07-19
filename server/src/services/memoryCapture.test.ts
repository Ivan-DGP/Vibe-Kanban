import { describe, test, expect, beforeAll, afterEach, afterAll } from "bun:test";
import crypto from "node:crypto";
import { getDb } from "../db";
import { captureMemoryFromRun } from "./memoryCapture";
import type { ProjectMemoryEvent } from "@vibe-kanban/shared";

const PROJECT_ID = `__mem_capture_${crypto.randomUUID()}__`;
const TASK_ID = crypto.randomUUID();

// Embeddings off: appendMemory still inserts the memory row; only the background
// embed is a no-op, so capture is testable without loading the model.
function seedRun(opts: {
  status: string;
  summary?: string | null;
  deviations?: { notes?: string } | null;
}): string {
  const runId = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO task_ai_runs (id, taskId, projectId, profile, status, startedAt, summary, deviations)
       VALUES (?, ?, ?, 'headless', ?, ?, ?, ?)`,
    )
    .run(
      runId,
      TASK_ID,
      PROJECT_ID,
      opts.status,
      new Date().toISOString(),
      opts.summary ?? null,
      opts.deviations ? JSON.stringify(opts.deviations) : null,
    );
  return runId;
}

function memory(): ProjectMemoryEvent[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM project_memory WHERE projectId = ? ORDER BY createdAt")
    .all(PROJECT_ID)
    .map((r) => {
      const row = r as ProjectMemoryEvent & { files: string };
      return { ...row, files: JSON.parse(row.files || "[]") };
    });
}

beforeAll(() => {
  process.env.VK_DISABLE_EMBEDDINGS = "1";
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO projects (id, name, path) VALUES (?, ?, ?)").run(
    PROJECT_ID,
    "Mem Capture Test",
    `/tmp/mem-capture-${PROJECT_ID}`,
  );
  db.prepare("INSERT OR REPLACE INTO tasks (id, projectId, title) VALUES (?, ?, ?)").run(
    TASK_ID,
    PROJECT_ID,
    "capture task",
  );
});

afterEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM project_memory WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM task_ai_runs WHERE projectId = ?").run(PROJECT_ID);
});

afterAll(() => {
  delete process.env.VK_DISABLE_EMBEDDINGS;
  const db = getDb();
  db.prepare("DELETE FROM project_memory WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM task_ai_runs WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM tasks WHERE projectId = ?").run(PROJECT_ID);
  db.prepare("DELETE FROM projects WHERE id = ?").run(PROJECT_ID);
});

describe("captureMemoryFromRun", () => {
  test("captures material deviations as a gotcha with provenance", () => {
    const runId = seedRun({
      status: "succeeded",
      deviations: { notes: "Had to disable the WAL checkpoint or migrations deadlock on startup." },
    });
    captureMemoryFromRun({ runId, taskId: TASK_ID, projectId: PROJECT_ID });

    const events = memory();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("gotcha");
    expect(events[0].origin).toBe("ai_captured");
    expect(events[0].taskId).toBe(TASK_ID);
    expect(events[0].runId).toBe(runId);
    expect(events[0].title.length).toBeGreaterThan(0);
  });

  test("captures a failed run's summary as attempt_failed", () => {
    const runId = seedRun({
      status: "failed",
      summary: "Tried migrating tasks table in place; FK enforcement aborted the DROP. Reverted.",
    });
    captureMemoryFromRun({ runId, taskId: TASK_ID, projectId: PROJECT_ID });

    const events = memory();
    expect(events.map((e) => e.type)).toEqual(["attempt_failed"]);
  });

  test("does NOT capture a succeeded run's summary (material-only, low signal)", () => {
    const runId = seedRun({
      status: "succeeded",
      summary: "Implemented the feature and all tests pass. Everything looks good here now.",
    });
    captureMemoryFromRun({ runId, taskId: TASK_ID, projectId: PROJECT_ID });
    expect(memory().length).toBe(0);
  });

  test("skips sub-material (too short) deviations", () => {
    const runId = seedRun({ status: "succeeded", deviations: { notes: "n/a" } });
    captureMemoryFromRun({ runId, taskId: TASK_ID, projectId: PROJECT_ID });
    expect(memory().length).toBe(0);
  });

  test("dedupes identical deviations across re-runs (same project + type + body)", () => {
    const notes = "Restore hangs after manifest load unless NFS mount is remounted first.";
    const r1 = seedRun({ status: "failed", deviations: { notes } });
    captureMemoryFromRun({ runId: r1, taskId: TASK_ID, projectId: PROJECT_ID });
    const r2 = seedRun({ status: "failed", deviations: { notes } });
    captureMemoryFromRun({ runId: r2, taskId: TASK_ID, projectId: PROJECT_ID });

    const gotchas = memory().filter((e) => e.type === "gotcha");
    expect(gotchas.length).toBe(1);
  });

  test("does NOT capture a usage-limit give-up summary (false failed-approach signal)", () => {
    const runId = seedRun({
      status: "failed",
      summary: "auto-resume gave up after 5 attempt(s); usage limit not cleared",
    });
    captureMemoryFromRun({ runId, taskId: TASK_ID, projectId: PROJECT_ID });
    expect(memory().length).toBe(0);
  });

  test("never throws when the run does not exist", () => {
    expect(() =>
      captureMemoryFromRun({ runId: "nonexistent", taskId: TASK_ID, projectId: PROJECT_ID }),
    ).not.toThrow();
    expect(memory().length).toBe(0);
  });

  test("captures both a gotcha and attempt_failed from one failed run with deviations", () => {
    const runId = seedRun({
      status: "failed",
      summary: "Attempted the sqlite-vec extension; it will not load under Bun's bundled SQLite.",
      deviations: {
        notes: "Fell back to brute-force cosine because the ANN index was unavailable.",
      },
    });
    captureMemoryFromRun({ runId, taskId: TASK_ID, projectId: PROJECT_ID });
    const types = memory()
      .map((e) => e.type)
      .sort();
    expect(types).toEqual(["attempt_failed", "gotcha"]);
  });
});
