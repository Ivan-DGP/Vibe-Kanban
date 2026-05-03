import fs from "node:fs";
import type { Task, Project } from "@vibe-kanban/shared";
import { getDb } from "../db";
import { log } from "../lib/logger";
import { spawnHeadlessClaude } from "./headlessClaude";
import { writeTempMcpConfig, cleanupMcpConfig } from "./mcpConfigWriter";
import { getSpawnConfig } from "./taskSpawnRegistry";

function projectFromRow(row: any): Project | null {
  if (!row) return null;
  return {
    ...row,
    favorite: !!row.favorite,
    techStack: JSON.parse(row.techStack || "[]"),
    externalLinks: JSON.parse(row.externalLinks || "[]"),
    autoSpawnEnabled: !!row.autoSpawnEnabled,
  } as Project;
}

/**
 * Look at a freshly inserted/updated task and, if its `metadata.type` matches a
 * registered spawn config AND the project has `autoSpawnEnabled`, fire a
 * headless Claude session in the background.
 *
 * Always async/fire-and-forget — never blocks the request that triggered it
 * and never throws. Failures are logged.
 */
export function maybeSpawnForTask(task: Task): void {
  void runSpawn(task).catch((err) => {
    log("error", "claude", `taskSpawner unhandled error`, {
      taskId: task.id,
      error: String(err),
    });
  });
}

async function runSpawn(task: Task): Promise<void> {
  const metadataType =
    task.metadata && typeof task.metadata === "object"
      ? (task.metadata as Record<string, unknown>).type
      : undefined;
  if (typeof metadataType !== "string" || !metadataType) return;

  const config = getSpawnConfig(metadataType);
  if (!config) return;

  const db = getDb();
  const projectRow = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(task.projectId);
  const project = projectFromRow(projectRow);
  if (!project) {
    log("warn", "claude", `taskSpawner: project not found`, {
      taskId: task.id,
      projectId: task.projectId,
    });
    return;
  }

  if (!project.autoSpawnEnabled) return;

  // Bun.spawn surfaces a missing cwd as a misleading
  // `posix_spawn '<cmd>' ENOENT` — gate it cleanly here.
  if (!project.path || !fs.existsSync(project.path)) {
    log("warn", "claude", `taskSpawner: project.path missing on disk`, {
      taskId: task.id,
      projectId: project.id,
      path: project.path,
    });
    return;
  }

  let mcpConfigPath: string | null = null;
  try {
    mcpConfigPath = await writeTempMcpConfig({
      project,
      servers: config.mcpServers,
    });

    const prompt = config.buildPrompt({ task, project });

    log("info", "claude", `taskSpawner dispatching`, {
      taskId: task.id,
      projectId: project.id,
      type: metadataType,
      profile: config.profile,
    });

    await spawnHeadlessClaude({
      prompt,
      taskId: task.id,
      projectId: project.id,
      mcpConfigPath,
      cwd: project.path,
      profile: config.profile,
      timeoutMs: config.timeoutMs,
    });
  } catch (err) {
    log("error", "claude", `taskSpawner failed`, {
      taskId: task.id,
      type: metadataType,
      error: String(err),
    });
  } finally {
    if (mcpConfigPath) cleanupMcpConfig(mcpConfigPath);
  }
}
