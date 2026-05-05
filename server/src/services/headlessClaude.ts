import { spawnProcess } from "../lib/runtime";
import { getDb } from "../db";
import { log } from "../lib/logger";

export interface HeadlessClaudeOptions {
  prompt: string;
  taskId: string;
  projectId: string;
  mcpConfigPath: string;
  cwd: string;
  profile?: string;
  timeoutMs?: number;
}

export interface HeadlessClaudeResult {
  exitCode: number;
  summary: string | null;
  sessionId: string | null;
  durationMs: number;
  runId: string;
}

const DEFAULT_TIMEOUT_MS = (() => {
  const fromEnv = Number(process.env.VK_HEADLESS_CLAUDE_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 15 * 60 * 1000;
})();
const CONCURRENCY_CAP = (() => {
  const fromEnv = Number(process.env.VK_HEADLESS_CLAUDE_CONCURRENCY);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 3;
})();

let inFlight = 0;
const queue: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < CONCURRENCY_CAP) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  inFlight++;
}

function releaseSlot(): void {
  inFlight--;
  const next = queue.shift();
  if (next) next();
}

export function getHeadlessClaudeStats(): { inFlight: number; queued: number; cap: number } {
  return { inFlight, queued: queue.length, cap: CONCURRENCY_CAP };
}

export interface ParsedClaudeJson {
  sessionId: string | null;
  summary: string | null;
}

export function parseClaudeOutput(stdout: string): ParsedClaudeJson {
  const trimmed = stdout.trim();
  if (!trimmed) return { sessionId: null, summary: null };

  try {
    const parsed = JSON.parse(trimmed);
    return {
      sessionId: parsed.session_id ?? parsed.sessionId ?? null,
      summary: parsed.result ?? parsed.summary ?? null,
    };
  } catch {
    // Streaming-JSON or partial output — try to recover the last well-formed object.
    const lines = trimmed.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed.session_id || parsed.result) {
          return {
            sessionId: parsed.session_id ?? null,
            summary: parsed.result ?? null,
          };
        }
      } catch {
        // keep scanning
      }
    }
    return { sessionId: null, summary: trimmed.slice(-1000) };
  }
}

export async function spawnHeadlessClaude(
  opts: HeadlessClaudeOptions,
): Promise<HeadlessClaudeResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const profile = opts.profile ?? "headless";

  await acquireSlot();
  const started = Date.now();
  const runId = crypto.randomUUID();

  try {
    const cmd = [
      "claude",
      "-p",
      "--output-format",
      "json",
      "--mcp-config",
      opts.mcpConfigPath,
      "--dangerously-skip-permissions",
      opts.prompt,
    ];

    log("info", "claude", `headless claude spawn`, {
      runId,
      taskId: opts.taskId,
      projectId: opts.projectId,
      profile,
    });

    const result = await spawnProcess(cmd, {
      cwd: opts.cwd,
      timeout: timeoutMs,
    });

    const durationMs = Date.now() - started;
    const { sessionId, summary } = parseClaudeOutput(result.stdout);
    const success = result.exitCode === 0 ? 1 : 0;

    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO task_ai_runs (id, taskId, projectId, sessionId, profile, complexity, exitCode, success, durationMs, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        runId,
        opts.taskId,
        opts.projectId,
        sessionId,
        profile,
        "medium",
        result.exitCode,
        success,
        durationMs,
        summary,
      );
    } catch (e) {
      log("error", "claude", `failed to record task_ai_run`, { runId, error: String(e) });
    }

    if (result.exitCode !== 0) {
      log("warn", "claude", `headless claude non-zero exit`, {
        runId,
        exitCode: result.exitCode,
        stderr: result.stderr.slice(-500),
      });
    }

    return { exitCode: result.exitCode, summary, sessionId, durationMs, runId };
  } finally {
    releaseSlot();
  }
}
