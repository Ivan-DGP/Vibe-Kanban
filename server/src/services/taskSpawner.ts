import fs from "node:fs";
import type { Task, Project } from "@vibe-kanban/shared";
import { getDb } from "../db";
import { log } from "../lib/logger";
import { spawnHeadlessClaude, hasRunningRun } from "./headlessClaude";
import { writeTempMcpConfig, cleanupMcpConfig } from "./mcpConfigWriter";
import { getSpawnConfig, type SpawnConfig } from "./taskSpawnRegistry";
import { maybeRunPreflight } from "./taskPreflight";

const DEFAULT_MAX_ATTEMPTS = 2;

/** Resolve attempt count: env override > per-config > default. Clamped to 1..5. */
export function maxAttemptsFor(config: Pick<SpawnConfig, "maxAttempts">): number {
  const fromEnv = Number(process.env.VK_TASK_MAX_ATTEMPTS);
  const raw =
    Number.isFinite(fromEnv) && fromEnv > 0
      ? fromEnv
      : (config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  return Math.min(Math.max(Math.floor(raw), 1), 5);
}

/** Exponential backoff between attempts: 2s, 4s, 8s … capped at 30s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** (attempt - 1));
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  const projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(task.projectId);
  const project = projectFromRow(projectRow);
  if (!project) {
    log("warn", "claude", `taskSpawner: project not found`, {
      taskId: task.id,
      projectId: task.projectId,
    });
    return;
  }

  if (!project.autoSpawnEnabled) return;

  // Idempotency: don't fire a second run for a task that already has one in
  // flight (rapid successive PATCHes would otherwise double-spawn).
  if (hasRunningRun(task.id)) {
    log("info", "claude", `taskSpawner: skip — run already in flight`, { taskId: task.id });
    return;
  }

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

  const prompt = config.buildPrompt({ task, project });
  const maxAttempts = maxAttemptsFor(config);

  log("info", "claude", `taskSpawner dispatching`, {
    taskId: task.id,
    projectId: project.id,
    type: metadataType,
    profile: config.profile,
    maxAttempts,
  });

  // Retry on failure: each attempt gets a fresh runId (and thus a fresh per-run
  // MCP config + worktree), so a failed attempt's worktree is discarded and the
  // retry starts clean. Every attempt is recorded as its own task_ai_runs row.
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // runId is generated up front so the MCP config can point the agent at this
    // run's per-run endpoint (/mcp/run/<runId>).
    const runId = crypto.randomUUID();
    let mcpConfigPath: string | null = null;
    try {
      mcpConfigPath = await writeTempMcpConfig({
        project,
        servers: config.mcpServers,
        runId,
      });

      await maybeRunPreflight({
        runId,
        taskId: task.id,
        projectId: project.id,
        cwd: project.path,
      }).catch(() => null);

      const result = await spawnHeadlessClaude({
        prompt,
        taskId: task.id,
        projectId: project.id,
        mcpConfigPath,
        cwd: project.path,
        profile: config.profile,
        timeoutMs: config.timeoutMs,
        runId,
      });

      if (result.exitCode === 0) return; // success — done
      log("warn", "claude", `taskSpawner attempt failed`, {
        taskId: task.id,
        attempt,
        maxAttempts,
        exitCode: result.exitCode,
      });
    } catch (err) {
      log("error", "claude", `taskSpawner attempt errored`, {
        taskId: task.id,
        attempt,
        error: String(err),
      });
    } finally {
      if (mcpConfigPath) cleanupMcpConfig(mcpConfigPath);
    }

    if (attempt < maxAttempts) await delay(retryDelayMs(attempt));
  }

  log("warn", "claude", `taskSpawner exhausted retries`, {
    taskId: task.id,
    type: metadataType,
    maxAttempts,
  });
}
