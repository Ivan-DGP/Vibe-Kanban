import path from "node:path";
import fs from "node:fs";
import { getDb } from "../db";
import { getTaskSnapshotDir } from "../lib/data-dir";
import { writeFile } from "../lib/runtime";

export function writeTaskSnapshot(projectId: string): void {
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

  const project = db
    .prepare("SELECT name FROM projects WHERE id = ?")
    .get(projectId) as { name: string } | null;

  const snapshot = {
    projectId,
    projectName: project?.name ?? "Unknown",
    exportedAt: new Date().toISOString(),
    tasks: (tasks as any[]).map((t) => ({
      ...t,
      milestoneName: t.milestoneName ?? "General",
    })),
  };

  const dir = getTaskSnapshotDir();
  const filePath = path.join(dir, `${projectId}.json`);
  const tmpPath = filePath + ".tmp";

  writeFile(tmpPath, JSON.stringify(snapshot, null, 2)).then(() => {
    fs.renameSync(tmpPath, filePath);
  });
}
