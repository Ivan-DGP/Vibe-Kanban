/**
 * Phase L: env-gated bench capture service.
 *
 * When VK_BENCH_CAPTURE=1, a successful or failed `task_ai_runs` insert in
 * `headlessClaude.ts` triggers `captureTaskAiRun()`. We bundle the workdir as
 * a tar.gz alongside an anonymized JSON sidecar, written under
 * `benchmarks/replays/` (gitignored). Override the location with
 * VK_BENCH_REPLAY_DIR.
 *
 * Failures here are best-effort: capture never throws into the AI run path.
 */

import path from "node:path";
import fs from "node:fs";

import { spawnProcess } from "../lib/runtime";
import { getDb } from "../db";
import { log } from "../lib/logger";
import {
  anonymizePayload,
  truncate,
  SCHEMA_VERSION,
  type AnonymizedPayload,
} from "./taskAiCaptureAnonymize";

const TAR_EXCLUDE_PATTERNS = [
  "node_modules",
  ".git",
  ".vk-bench",
  ".env",
  ".env.*",
  "dist",
  "build",
  "*.log",
  ".DS_Store",
  // Secret-bearing files: defense-in-depth so a captured tarball never archives
  // credentials even when capture is explicitly enabled.
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa*",
  "id_ed25519*",
  ".ssh",
  ".npmrc",
  ".netrc",
  "*.db",
  "*.sqlite",
  "credentials*",
  "secrets*",
];

const MAX_TEXT_LEN = 32_000;
const TAR_TIMEOUT_MS = 60_000;

export function isCaptureEnabled(): boolean {
  // Default OFF everywhere. Capture writes prompts + a working-tree snapshot to
  // disk, so it requires explicit opt-in via VK_BENCH_CAPTURE=1 (no silent
  // default-on in dev).
  return process.env.VK_BENCH_CAPTURE === "1";
}

export function getReplayDir(): string {
  const fromEnv = process.env.VK_BENCH_REPLAY_DIR;
  const target = fromEnv
    ? path.resolve(fromEnv)
    : path.resolve(import.meta.dir, "..", "..", "..", "benchmarks", "replays");
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  return target;
}

export interface ReplayPayloadSidecar {
  schemaVersion: number;
  capturedAt: string;
  runId: string;
  taskId: string;
  projectId: string;
  payload: AnonymizedPayload;
  outcome: {
    exitCode: number;
    durationMs: number;
    summary: string | null;
    sessionId: string | null;
  };
  workdirArchive: string;
}

export interface CaptureTaskAiRunInput {
  runId: string;
  taskId: string;
  projectId: string;
  cwd: string;
  exitCode: number;
  durationMs: number;
  summary: string | null;
  sessionId: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  prompt: string | null;
  metadata: string | null;
}

function loadProjectAndTask(
  projectId: string,
  taskId: string,
): { project: ProjectRow; task: TaskRow } | null {
  const db = getDb();
  const project = db.prepare("SELECT id, name, path FROM projects WHERE id = ?").get(projectId) as
    | ProjectRow
    | undefined;
  if (!project) return null;
  const task = db
    .prepare("SELECT id, title, description, prompt, metadata FROM tasks WHERE id = ?")
    .get(taskId) as TaskRow | undefined;
  if (!task) return null;
  return { project, task };
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export async function captureTaskAiRun(input: CaptureTaskAiRunInput): Promise<void> {
  if (!isCaptureEnabled()) return;
  try {
    if (!fs.existsSync(input.cwd)) return;

    const found = loadProjectAndTask(input.projectId, input.taskId);
    if (!found) return;
    const { project, task } = found;

    const payload = anonymizePayload({
      cwd: input.cwd,
      projectPath: project.path,
      projectName: project.name,
      taskTitle: task.title,
      taskDescription: task.description,
      taskPrompt: task.prompt,
      taskMetadata: parseMetadata(task.metadata),
      outcomeSummary: input.summary,
    });

    payload.task.title = truncate(payload.task.title, MAX_TEXT_LEN) ?? "";
    payload.task.description = truncate(payload.task.description, MAX_TEXT_LEN);
    payload.task.prompt = truncate(payload.task.prompt, MAX_TEXT_LEN);
    payload.outcome.summary = truncate(payload.outcome.summary, MAX_TEXT_LEN);

    const replayDir = getReplayDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = `${stamp}-${input.runId}`;
    const archivePath = path.join(replayDir, `${slug}.tar.gz`);
    const sidecarPath = path.join(replayDir, `${slug}.json`);

    const excludeArgs = TAR_EXCLUDE_PATTERNS.flatMap((p) => ["--exclude", p]);
    const cwdParent = path.dirname(input.cwd);
    const cwdBase = path.basename(input.cwd);
    const tarRes = await spawnProcess(
      ["tar", "-czf", archivePath, ...excludeArgs, "-C", cwdParent, cwdBase],
      { cwd: cwdParent, timeout: TAR_TIMEOUT_MS },
    );
    if (tarRes.exitCode !== 0) {
      log("warn", "claude", "bench-capture: tar failed", {
        runId: input.runId,
        stderr: tarRes.stderr.slice(-500),
      });
      try {
        if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
      } catch {
        // ignore cleanup errors
      }
      return;
    }

    const sidecar: ReplayPayloadSidecar = {
      schemaVersion: SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      runId: input.runId,
      taskId: input.taskId,
      projectId: input.projectId,
      payload,
      outcome: {
        exitCode: input.exitCode,
        durationMs: input.durationMs,
        summary: payload.outcome.summary,
        sessionId: input.sessionId,
      },
      workdirArchive: path.basename(archivePath),
    };

    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf8");
    log("info", "claude", "bench-capture: captured replay", { runId: input.runId, slug });
  } catch (e) {
    log("warn", "claude", "bench-capture: capture failed", {
      runId: input.runId,
      error: String(e),
    });
  }
}
