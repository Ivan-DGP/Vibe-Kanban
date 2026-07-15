// ── AI resolver agent abstraction ──────────────────────────────
//
// The AI Resolve / batch-resolve flow can run through different agent CLIs.
// This module resolves the binary and builds the argv per agent, keeping the
// spawn call in terminalService agent-agnostic. Claude is the default and its
// argv is kept byte-for-byte identical to the pre-existing hardcoded command.

import type { AiAgent } from "@vibe-kanban/shared";
import { getDb } from "../db";
import { spawnProcessSync } from "../lib/runtime";

export const AI_AGENTS: AiAgent[] = ["claude", "opencode", "grok"];

const AGENT_BINARY: Record<AiAgent, string> = {
  claude: "claude",
  opencode: "opencode",
  grok: "grok",
};

/** Read the globally configured resolver agent; defaults to "claude". */
export function getConfiguredAgent(): AiAgent {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'aiAgent'").get() as
      | { value: string }
      | undefined;
    if (row) {
      const parsed = JSON.parse(row.value);
      if (AI_AGENTS.includes(parsed)) return parsed;
    }
  } catch {
    /* fall through to default */
  }
  return "claude";
}

/** Resolve the agent's executable path via which/where, falling back to the bare name. */
export function resolveAgentBinary(agent: AiAgent, safeEnv: Record<string, string>): string {
  const name = AGENT_BINARY[agent];
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const result = spawnProcessSync([whichCmd, name], { env: safeEnv });
    if (result.exitCode === 0) {
      return result.stdout.split(/\r?\n/)[0];
    }
  } catch {
    /* fall through to bare name */
  }
  return name;
}

/** True when the agent binary is discoverable on PATH. */
export function isAgentAvailable(agent: AiAgent, safeEnv: Record<string, string>): boolean {
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    return spawnProcessSync([whichCmd, AGENT_BINARY[agent]], { env: safeEnv }).exitCode === 0;
  } catch {
    return false;
  }
}

export interface ResolveArgsOptions {
  prompt: string;
  /** Pinned Claude session id (`--session-id`). Unused by OpenCode, which assigns its own. */
  claudeSessionId?: string;
  /** Optional model override. */
  model?: string;
}

/**
 * Build the argv for a one-shot AI resolve run.
 *
 * claude:   claude --session-id <id> --dangerously-skip-permissions [--model <m>] <prompt>
 * opencode: opencode run --auto [-m <model>] <prompt>
 * grok:     grok -p <prompt> [-m <model>]   (headless mode auto-executes; prompt is the -p value)
 */
export function buildResolveArgs(agent: AiAgent, opts: ResolveArgsOptions): string[] {
  const { prompt, claudeSessionId, model } = opts;
  if (agent === "opencode") {
    const args = ["run", "--auto"];
    if (model) args.push("-m", model);
    args.push(prompt);
    return args;
  }
  if (agent === "grok") {
    const args = ["-p", prompt];
    if (model) args.push("-m", model);
    return args;
  }
  // claude (default) — keep identical to the original hardcoded command
  const args: string[] = [];
  if (claudeSessionId) args.push("--session-id", claudeSessionId);
  args.push("--dangerously-skip-permissions");
  if (model) args.push("--model", model);
  args.push(prompt);
  return args;
}

/**
 * Non-interactive one-shot: run the agent CLI with a prompt, return stdout or null.
 * claude: -p <prompt> | opencode: run <prompt> | grok: -p <prompt> --output-format plain
 */
export function runAgentOneShot(
  prompt: string,
  safeEnv: Record<string, string>,
  agent?: AiAgent,
): string | null {
  const a = agent ?? getConfiguredAgent();
  if (!isAgentAvailable(a, safeEnv)) return null;

  let argv: string[];
  if (a === "opencode") {
    argv = ["run", prompt];
  } else if (a === "grok") {
    argv = ["-p", prompt, "--output-format", "plain"];
  } else {
    argv = ["-p", prompt];
  }

  try {
    const result = spawnProcessSync([resolveAgentBinary(a, safeEnv), ...argv], {
      env: safeEnv,
      timeout: 120_000, // don't let a hung agent block the request
    });
    if (result.exitCode === 0) return result.stdout.trim();
    return null;
  } catch {
    return null;
  }
}
