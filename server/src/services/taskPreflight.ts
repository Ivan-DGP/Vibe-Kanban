/**
 * Phase #3: production analog of bench preflight (P4 raw-baseline gate).
 *
 * Before `taskSpawner.runSpawn` invokes `spawnHeadlessClaude`, we optionally
 * run the project's own test command on the working tree. If tests are
 * already red, we record a `PREFLIGHT-RED` finding so the AI run is tagged
 * "started from a broken baseline" — the operator can later distinguish
 * "AI broke this" from "this was already broken."
 *
 * Opt-in per project via `aiInstructions` JSON:
 *   { "preflight": { "testCommand": "bun test", "timeoutMs": 60000 } }
 *
 * Like `taskAiCapture` and `headlessClaudeAdversarial`, failures here are
 * best-effort: never throw into the spawn path.
 */

import { spawnProcess } from "../lib/runtime";
import { getDb } from "../db";
import { log } from "../lib/logger";
import { recordFindings } from "./headlessClaudeAdversarial";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_DETAIL_LEN = 2_000;

export interface PreflightConfig {
  testCommand: string;
  timeoutMs: number;
}

export interface PreflightOutcome {
  ran: boolean;
  passed: boolean;
  exitCode: number | null;
  detail: string | null;
}

/**
 * Read project preflight config from `projects.aiInstructions`. Returns null
 * when the project hasn't opted in. Free-form aiInstructions text (the
 * common case) parses as JSON-fail and yields null silently.
 */
export function loadPreflightConfig(projectId: string): PreflightConfig | null {
  try {
    const db = getDb();
    const row = db.prepare("SELECT aiInstructions FROM projects WHERE id = ?").get(projectId) as
      | { aiInstructions: string | null }
      | undefined;
    if (!row?.aiInstructions) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.aiInstructions);
    } catch {
      return null;
    }
    const cfg = (parsed as Record<string, unknown> | null)?.preflight as
      | Record<string, unknown>
      | undefined;
    if (!cfg) return null;
    const testCommand = typeof cfg.testCommand === "string" ? cfg.testCommand.trim() : "";
    if (!testCommand) return null;
    const timeoutMs =
      typeof cfg.timeoutMs === "number" && Number.isFinite(cfg.timeoutMs) && cfg.timeoutMs > 0
        ? Math.floor(cfg.timeoutMs)
        : DEFAULT_TIMEOUT_MS;
    return { testCommand, timeoutMs };
  } catch {
    return null;
  }
}

/**
 * Split a shell-style command into argv tokens. Supports double-quoted
 * substrings; otherwise whitespace-split. Refuses pipes/redirections so we
 * never wind up shelling out arbitrary text.
 */
export function tokenizeCommand(cmd: string): string[] | null {
  if (/[|&;<>`$]/.test(cmd)) return null;
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return tokens.length > 0 ? tokens : null;
}

export interface RunPreflightInput {
  projectId: string;
  cwd: string;
  config: PreflightConfig;
}

export async function runPreflight(input: RunPreflightInput): Promise<PreflightOutcome> {
  const argv = tokenizeCommand(input.config.testCommand);
  if (!argv) {
    return {
      ran: false,
      passed: false,
      exitCode: null,
      detail: `unsafe testCommand: ${input.config.testCommand}`,
    };
  }
  try {
    const r = await spawnProcess(argv, {
      cwd: input.cwd,
      timeout: input.config.timeoutMs,
    });
    if (r.exitCode === 0) {
      return { ran: true, passed: true, exitCode: 0, detail: null };
    }
    const tail = (r.stderr || r.stdout).slice(-MAX_DETAIL_LEN);
    return {
      ran: true,
      passed: false,
      exitCode: r.exitCode,
      detail: `exit=${r.exitCode} cmd="${input.config.testCommand}"\n${tail}`,
    };
  } catch (e) {
    return {
      ran: false,
      passed: false,
      exitCode: null,
      detail: `preflight spawn error: ${String(e)}`,
    };
  }
}

export interface MaybeRunPreflightInput {
  runId: string;
  taskId: string;
  projectId: string;
  cwd: string;
}

/**
 * High-level entry: read project config, run preflight, persist a
 * PREFLIGHT-RED finding if tests failed. Returns the outcome so the caller
 * can react (e.g. tag the spawn). No-op when the project isn't opted in.
 */
export async function maybeRunPreflight(
  input: MaybeRunPreflightInput,
): Promise<PreflightOutcome | null> {
  const config = loadPreflightConfig(input.projectId);
  if (!config) return null;
  const outcome = await runPreflight({
    projectId: input.projectId,
    cwd: input.cwd,
    config,
  });
  if (outcome.ran && !outcome.passed) {
    recordFindings({
      runId: input.runId,
      taskId: input.taskId,
      projectId: input.projectId,
      findings: [
        {
          kind: "PREFLIGHT-RED",
          detail: outcome.detail ?? `exit=${outcome.exitCode}`,
        },
      ],
    });
    log("warn", "claude", "preflight: baseline red before AI run", {
      runId: input.runId,
      taskId: input.taskId,
      exitCode: outcome.exitCode,
    });
  }
  return outcome;
}

export const __TEST__ = { DEFAULT_TIMEOUT_MS, MAX_DETAIL_LEN };
