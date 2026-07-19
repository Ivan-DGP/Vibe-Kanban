// Agentic engine for the Specialist chat. Instead of pre-grounding then a one-shot
// answer, this runs `claude -p` wired to the in-process vibe-kanban MCP server so
// the model drives its OWN multi-hop tool calls (cross_project_search,
// cross_project_memory_search, list_projects, get_all_tasks) before answering.
//
// OPT-IN (VK_SPECIALIST_AGENTIC, default OFF) and only used when the MCP endpoint
// is actually reachable without a bearer token (mcpEnabled + auth off) — the temp
// MCP config carries no token. When either is missing, the caller falls back to the
// grounded one-shot engine. Never flips those security settings itself.
//
// Output is `--output-format stream-json`; a pure parser (createStreamJsonParser)
// translates the NDJSON events into SSE frames: tool_use → `tool`, assistant text →
// `delta`, terminal/error → surfaced by the caller.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { FastifyReply } from "fastify";
import { getDb } from "../db";
import { isAuthRequired } from "../mcp/auth";
import { getVibeKanbanSseUrl } from "./mcpConfigWriter";
import { spawnStreaming } from "../lib/runtime";
import { getSafeEnv } from "./terminalRegistry";
import { log } from "../lib/logger";

// Cap a runaway agent — it can call tools in a loop. Well above a normal answer.
const AGENTIC_TIMEOUT_MS = 120_000;
const TOOL_SUMMARY_CHARS = 100;

// The ONLY tools the specialist agent may use — the read-only cross-project MCP
// tools, named `mcp__<server>__<tool>` (server "vibe-kanban" from the config). No
// built-in Bash/Read/Write/Edit, so a chat turn cannot touch the host.
const SPECIALIST_MCP_TOOLS = [
  "mcp__vibe-kanban__cross_project_search",
  "mcp__vibe-kanban__cross_project_memory_search",
  "mcp__vibe-kanban__list_projects",
  "mcp__vibe-kanban__get_all_tasks",
];

export interface AgentFrame {
  type: "tool" | "delta" | "error";
  /** tool: the tool name; a short input summary in `summary`. */
  name?: string;
  summary?: string;
  /** delta: streamed answer text. */
  text?: string;
  /** error: message. */
  message?: string;
}

/** Opt-in, read at CALL time (same convention as VK_SUPERVISOR_DISPATCH_ENABLED). */
export function isSpecialistAgenticEnabled(): boolean {
  const v = process.env.VK_SPECIALIST_AGENTIC;
  return v === "true" || v === "1";
}

/** Is the in-process MCP endpoint reachable by the spawned CLI (enabled + no auth)?
 * The written MCP config cannot carry a bearer token, so auth MUST be off. */
export function agenticAvailable(): boolean {
  try {
    const raw = getDb().query("SELECT value FROM settings WHERE key = 'mcpEnabled'").get() as
      | { value?: string }
      | undefined;
    const mcpEnabled = !!raw && JSON.parse(raw.value ?? "false") === true;
    return mcpEnabled && !isAuthRequired();
  } catch {
    return false;
  }
}

/** True when agentic is opted-in AND usable right now. */
export function useAgentic(): boolean {
  return isSpecialistAgenticEnabled() && agenticAvailable();
}

/** Compact, human-readable summary of a tool call's input for the UI step. */
function summarizeToolInput(input: unknown): string {
  if (
    input &&
    typeof input === "object" &&
    typeof (input as { query?: unknown }).query === "string"
  ) {
    return (input as { query: string }).query.slice(0, TOOL_SUMMARY_CHARS);
  }
  try {
    return JSON.stringify(input ?? {}).slice(0, TOOL_SUMMARY_CHARS);
  } catch {
    return "";
  }
}

/** Translate one parsed stream-json event into zero or more SSE frames. */
export function parseAgentEvent(evt: {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }> };
}): AgentFrame[] {
  const frames: AgentFrame[] = [];
  if (evt.type === "assistant" && evt.message?.content) {
    for (const block of evt.message.content) {
      if (block.type === "text" && block.text && block.text.trim()) {
        frames.push({ type: "delta", text: block.text });
      } else if (block.type === "tool_use" && block.name) {
        frames.push({ type: "tool", name: block.name, summary: summarizeToolInput(block.input) });
      }
    }
  } else if (
    evt.type === "result" &&
    (evt.is_error || (evt.subtype && evt.subtype !== "success"))
  ) {
    frames.push({ type: "error", message: evt.result || evt.subtype || "agent error" });
  }
  // system/init, user/tool_result, and successful result carry nothing to stream —
  // the caller emits the terminal `done` after the process exits.
  return frames;
}

/** Stateful NDJSON parser: feed raw stdout chunks, get SSE frames. Newline-buffered
 * because stream-json events are split arbitrarily across chunk boundaries. */
export function createStreamJsonParser() {
  let buffer = "";
  let sawText = false;
  let resultText: string | undefined;
  const handleLine = (line: string): AgentFrame[] => {
    const t = line.trim();
    if (!t) return [];
    let evt: Parameters<typeof parseAgentEvent>[0];
    try {
      evt = JSON.parse(t);
    } catch {
      return []; // ignore partial/non-JSON lines
    }
    // Stash a successful result's text as a fallback answer (used only if the model
    // streamed no assistant text — see fallbackAnswer()).
    if (
      evt?.type === "result" &&
      !evt.is_error &&
      (!evt.subtype || evt.subtype === "success") &&
      typeof evt.result === "string"
    ) {
      resultText = evt.result;
    }
    const frames = parseAgentEvent(evt);
    if (frames.some((f) => f.type === "delta")) sawText = true;
    return frames;
  };
  return {
    push(chunk: string): AgentFrame[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.flatMap(handleLine);
    },
    flush(): AgentFrame[] {
      const rest = buffer;
      buffer = "";
      return handleLine(rest);
    },
    /** The final result text, but only when no assistant text was streamed. */
    fallbackAnswer(): string | undefined {
      return sawText ? undefined : resultText;
    },
  };
}

/** Write a temp MCP config pointing at the in-process vibe-kanban server over the
 * streamable-HTTP transport (the `sse` transport doesn't reliably expose tools to a
 * headless CLI session). Returns the file path. */
async function writeSpecialistMcpConfig(): Promise<string> {
  const dir = path.join(os.tmpdir(), "vibe-kanban-mcp");
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `specialist-${crypto.randomUUID()}.json`);
  const config = {
    mcpServers: { "vibe-kanban": { type: "http", url: getVibeKanbanSseUrl() } },
  };
  await fs.promises.writeFile(file, JSON.stringify(config, null, 2));
  return file;
}

function cleanupSpecialistMcpConfig(file: string): void {
  try {
    if (file.startsWith(path.join(os.tmpdir(), "vibe-kanban-mcp"))) fs.unlinkSync(file);
  } catch {
    /* best effort */
  }
}

/** The instruction wrapping the user's question for the agentic run. */
export function buildAgenticPrompt(message: string): string {
  return [
    "You are the cross-project Specialist for this developer's workspace. You have",
    "MCP tools that search ALL of their projects: cross_project_search (knowledge:",
    "artifacts, tasks, graph), cross_project_memory_search (past lessons/decisions/",
    "failed attempts), list_projects, and get_all_tasks. Before answering, USE these",
    "tools to gather relevant context across projects — do not rely on memory alone.",
    "Then answer concisely and cite what you found as `label (project)`.",
    "",
    `Question: ${message}`,
  ].join("\n");
}

/**
 * Run the agentic Specialist and stream SSE frames into `reply`. Assumes the caller
 * has verified availability. Emits an `engine` prelude, then tool/delta frames, then
 * a terminal `done` (or `error`). Never throws; cleans up the temp MCP config.
 */
export async function streamAgenticChat(message: string, reply: FastifyReply): Promise<void> {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  // Guard every write: once the client disconnects (reply.raw.on("close")) the socket
  // is ended and further writes would throw.
  const write = (obj: unknown) => {
    if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  write({ type: "engine", mode: "agentic" });

  let cfgPath: string | null = null;
  try {
    cfgPath = await writeSpecialistMcpConfig();
    const proc = spawnStreaming(
      [
        "claude",
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        // Isolate from the developer's interactive Claude Code context (repo
        // CLAUDE.md / skills / memory / extended thinking) — same reason as the
        // grounded engine: it otherwise turns this into a heavy turn that times
        // out. Keep these BEFORE the variadic --allowedTools.
        "--setting-sources",
        "user",
        "--mcp-config",
        cfgPath,
        // SANDBOX: pre-approve ONLY the read-only cross-project MCP tools. Without
        // this (and with --dangerously-skip-permissions) the agent can run arbitrary
        // host Bash/Read/Write. Naming the tools also forces the CLI to load them up
        // front instead of deferring. No built-in tools are allowed, so a chat turn
        // can never touch the host filesystem or shell. `--allowedTools` is variadic,
        // so the prompt goes via stdin — otherwise it gets swallowed as a tool name.
        "--allowedTools",
        ...SPECIALIST_MCP_TOOLS,
      ],
      { env: getSafeEnv(), stdinData: buildAgenticPrompt(message) },
    );

    const timeout = setTimeout(() => proc.kill(), AGENTIC_TIMEOUT_MS);
    reply.raw.on("close", () => {
      clearTimeout(timeout);
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    });

    const parser = createStreamJsonParser();
    let deltaCount = 0;
    let errored = false;
    proc.onData((chunk) => {
      for (const f of parser.push(chunk)) {
        if (f.type === "delta") deltaCount++;
        if (f.type === "error") errored = true;
        write(f);
      }
    });
    let stderr = "";
    proc.onStderr((c) => {
      stderr += c;
    });

    const exitCode = await proc.exited;
    clearTimeout(timeout);
    for (const f of parser.flush()) {
      if (f.type === "delta") deltaCount++;
      if (f.type === "error") errored = true;
      write(f);
    }

    // Edge case: the model answered only via the terminal `result` event (no streamed
    // assistant text). Emit that as the answer rather than a spurious "no output".
    if (deltaCount === 0 && !errored) {
      const fallback = parser.fallbackAnswer();
      if (fallback) {
        write({ type: "delta", text: fallback });
        deltaCount++;
      }
    }

    if (deltaCount === 0 && !errored) {
      const detail =
        stderr.trim() ||
        `Specialist agent exited (code ${exitCode}) with no output. Check the Claude CLI + that MCP is enabled.`;
      log("error", "claude", "Specialist agentic run produced no output", { exitCode });
      write({ type: "error", message: detail });
    }
    write({ type: "done" });
  } catch (err) {
    write({ type: "error", message: err instanceof Error ? err.message : String(err) });
    write({ type: "done" });
  } finally {
    if (cfgPath) cleanupSpecialistMcpConfig(cfgPath);
    reply.raw.end();
  }
}
