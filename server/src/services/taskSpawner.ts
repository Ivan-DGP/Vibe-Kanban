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

export interface BuiltSpawnOpts {
  prompt: string;
  taskId: string;
  projectId: string;
  mcpConfigPath: string;
  cwd: string;
  profile: string;
  timeoutMs?: number;
  /** Removes the temp MCP config written for this runId. Caller owns the lifecycle. */
  cleanup: () => void;
}

/**
 * Assemble everything `spawnHeadlessClaude` needs for a task + a specific runId:
 * loads the task & project, resolves the spawn config, builds the prompt, and
 * writes a per-run MCP config pointed at runId's endpoint. Returns null when the
 * task/project/config is missing or the project path is gone.
 *
 * Shared by the retry loop (fresh runId per attempt) and the resume scheduler
 * (reuses the parked row's id). Deliberately does NOT gate on autoSpawnEnabled —
 * a resume completes work that already started.
 */
export async function buildSpawnOpts(
  taskId: string,
  runId: string,
): Promise<BuiltSpawnOpts | null> {
  const db = getDb();
  const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
  if (!taskRow) return null;
  const task = {
    ...taskRow,
    metadata: taskRow.metadata ? JSON.parse(taskRow.metadata) : {},
  } as Task;

  const metadataType =
    task.metadata && typeof task.metadata === "object"
      ? (task.metadata as Record<string, unknown>).type
      : undefined;
  const config =
    typeof metadataType === "string" && metadataType ? getSpawnConfig(metadataType) : undefined;

  const project = projectFromRow(
    db.prepare("SELECT * FROM projects WHERE id = ?").get(task.projectId),
  );
  if (!project || !project.path || !fs.existsSync(project.path)) return null;

  // Tasks without a registered spawn config (e.g. interactive AI-resolve runs that
  // were parked for usage-limit resume) fall back to a generic resolve config so the
  // scheduler can still continue them headlessly via `claude -p --resume`.
  const servers = config?.mcpServers ?? ["vibe-kanban"];
  const profile = config?.profile ?? "resolve";
  const prompt = config
    ? config.buildPrompt({ task, project })
    : task.prompt || [task.title, task.description].filter(Boolean).join("\n\n");

  const mcpConfigPath = await writeTempMcpConfig({ project, servers, runId });

  return {
    prompt,
    taskId: task.id,
    projectId: project.id,
    mcpConfigPath,
    cwd: project.path,
    profile,
    timeoutMs: config?.timeoutMs,
    cleanup: () => cleanupMcpConfig(mcpConfigPath),
  };
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
    const built = await buildSpawnOpts(task.id, runId);
    if (!built) {
      log("warn", "claude", `taskSpawner: could not assemble spawn opts`, { taskId: task.id });
      return;
    }
    const { cleanup, ...spawnOpts } = built;
    try {
      await maybeRunPreflight({
        runId,
        taskId: task.id,
        projectId: project.id,
        cwd: project.path,
      }).catch(() => null);

      const result = await spawnHeadlessClaude({ ...spawnOpts, runId });

      // Parked for usage-limit auto-resume — handed to resumeScheduler. Not a
      // failure; do NOT consume an attempt or fall into the backoff/exhaust path.
      if (result.parked) return;
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
      cleanup();
    }

    if (attempt < maxAttempts) await delay(retryDelayMs(attempt));
  }

  log("warn", "claude", `taskSpawner exhausted retries`, {
    taskId: task.id,
    type: metadataType,
    maxAttempts,
  });
}
