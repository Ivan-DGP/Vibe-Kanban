import fs from "node:fs";
import path from "node:path";

export interface TaskAiRunCheck {
  found: boolean;
  exitCode: number | null;
  success: number | null;
  durationMs: number | null;
  sessionIdSet: boolean;
  summarySet: boolean;
}

export interface TimestampCheck {
  inboxAtSet: boolean;
  inProgressAtSet: boolean;
  doneAtSet: boolean;
  cascadeOrdered: boolean;
}

export interface SnapshotCheck {
  fileExists: boolean;
  taskInSnapshot: boolean;
}

export interface EmbeddingsCheck {
  rowCount: number;
  skipped: boolean;
}

export function verifyTaskAiRun(getDb: () => any, taskId: string): TaskAiRunCheck {
  const row = getDb()
    .prepare(
      "SELECT exitCode, success, durationMs, summary, sessionId FROM task_ai_runs WHERE taskId = ? ORDER BY createdAt DESC LIMIT 1",
    )
    .get(taskId) as
    | {
        exitCode: number | null;
        success: number | null;
        durationMs: number | null;
        summary: string | null;
        sessionId: string | null;
      }
    | undefined;
  if (!row) {
    return {
      found: false,
      exitCode: null,
      success: null,
      durationMs: null,
      sessionIdSet: false,
      summarySet: false,
    };
  }
  return {
    found: true,
    exitCode: row.exitCode,
    success: row.success,
    durationMs: row.durationMs,
    sessionIdSet: !!row.sessionId,
    summarySet: !!row.summary,
  };
}

export function verifyTimestampCascade(getDb: () => any, taskId: string): TimestampCheck {
  const row = getDb()
    .prepare("SELECT status, inboxAt, inProgressAt, doneAt FROM tasks WHERE id = ?")
    .get(taskId) as
    | { status: string; inboxAt: string | null; inProgressAt: string | null; doneAt: string | null }
    | undefined;
  if (!row) {
    return { inboxAtSet: false, inProgressAtSet: false, doneAtSet: false, cascadeOrdered: false };
  }
  const inbox = row.inboxAt;
  const inProgress = row.inProgressAt;
  const done = row.doneAt;
  let cascadeOrdered = true;
  if (inbox && inProgress && inbox > inProgress) cascadeOrdered = false;
  if (inProgress && done && inProgress > done) cascadeOrdered = false;
  if (inbox && done && inbox > done) cascadeOrdered = false;
  return {
    inboxAtSet: !!inbox,
    inProgressAtSet: !!inProgress,
    doneAtSet: !!done,
    cascadeOrdered,
  };
}

export function verifySnapshot(dataDir: string, projectId: string, taskId: string): SnapshotCheck {
  const filePath = path.join(dataDir, "tasks", `${projectId}.json`);
  if (!fs.existsSync(filePath)) return { fileExists: false, taskInSnapshot: false };
  try {
    const snap = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      tasks?: Array<{ id: string }>;
    };
    const found = Array.isArray(snap.tasks) && snap.tasks.some((t) => t.id === taskId);
    return { fileExists: true, taskInSnapshot: found };
  } catch {
    return { fileExists: true, taskInSnapshot: false };
  }
}

export async function verifyEmbeddings(
  getDb: () => any,
  taskId: string,
  settleMs = 5000,
): Promise<EmbeddingsCheck> {
  const deadline = Date.now() + settleMs;
  let count = 0;
  while (Date.now() < deadline) {
    const row = getDb()
      .prepare("SELECT COUNT(*) AS n FROM task_embeddings WHERE taskId = ?")
      .get(taskId) as { n: number };
    count = row?.n ?? 0;
    if (count > 0) return { rowCount: count, skipped: false };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { rowCount: 0, skipped: true };
}

export interface SideEffectsResult {
  taskAiRun: TaskAiRunCheck;
  timestamps: TimestampCheck;
  snapshot: SnapshotCheck;
  embeddings: EmbeddingsCheck;
  allGreen: boolean;
}

export function summarize(checks: {
  taskAiRun: TaskAiRunCheck;
  timestamps: TimestampCheck;
  snapshot: SnapshotCheck;
  embeddings: EmbeddingsCheck;
}): SideEffectsResult {
  const { taskAiRun, timestamps, snapshot, embeddings } = checks;
  const allGreen =
    taskAiRun.found &&
    taskAiRun.summarySet &&
    timestamps.inboxAtSet &&
    timestamps.inProgressAtSet &&
    timestamps.doneAtSet &&
    timestamps.cascadeOrdered &&
    snapshot.fileExists &&
    snapshot.taskInSnapshot &&
    (embeddings.skipped || embeddings.rowCount > 0);
  return { taskAiRun, timestamps, snapshot, embeddings, allGreen };
}
