import path from "node:path";
import fs from "node:fs";
import { getDb } from "../db";
import { getTaskSnapshotDir } from "../lib/data-dir";
import { log } from "../lib/logger";
import { writeFile } from "../lib/runtime";

// Serialize writes per projectId so concurrent mutations can't interleave and
// produce torn snapshots. Each project gets a promise chain; new writes await
// the previous one before touching disk.
const writeQueues = new Map<string, Promise<void>>();
let writeCounter = 0;

function buildSnapshot(projectId: string): string {
  const db = getDb();
  const tasks = db
    .prepare(
      `SELECT t.*, m.name as milestoneName
       FROM tasks t
       LEFT JOIN milestones m ON t.milestoneId = m.id
       WHERE t.projectId = ?
       ORDER BY t.status, t.sortOrder`,
    )
    .all(projectId);

  const project = db.prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as {
    name: string;
  } | null;

  const snapshot = {
    projectId,
    projectName: project?.name ?? "Unknown",
    exportedAt: new Date().toISOString(),
    tasks: (tasks as any[]).map((t) => ({
      ...t,
      milestoneName: t.milestoneName ?? "General",
    })),
  };

  return JSON.stringify(snapshot, null, 2);
}

async function doWrite(projectId: string): Promise<void> {
  const dir = getTaskSnapshotDir();
  const filePath = path.join(dir, `${projectId}.json`);
  // Unique temp filename per write avoids clobbering a concurrent write's tmp.
  const tmpPath = `${filePath}.${process.pid}.${writeCounter++}.tmp`;

  const json = buildSnapshot(projectId);
  try {
    await writeFile(tmpPath, json);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    log("error", "tasks", `Failed to write task snapshot for ${projectId}`, { err: String(err) });
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Write the per-project task JSON snapshot. Returns a Promise so callers can
 * await it, but the per-project queue prevents corruption even when callers
 * fire-and-forget. Errors are caught/logged and never reject the queue chain.
 */
export function writeTaskSnapshot(projectId: string): Promise<void> {
  const prev = writeQueues.get(projectId) ?? Promise.resolve();
  const next = prev.then(() => doWrite(projectId));
  writeQueues.set(projectId, next);
  // Clear the queue slot once it settles (only if nothing newer was chained).
  next.finally(() => {
    if (writeQueues.get(projectId) === next) writeQueues.delete(projectId);
  });
  return next;
}
