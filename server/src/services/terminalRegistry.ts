import { getDb } from "../db";
import { log } from "../lib/logger";
import type { PtyHandle } from "../lib/runtime";
import type { TerminalSessionType, GroundedArtifact } from "@vibe-kanban/shared";

// Session registry + I/O plumbing for the terminal service. Split out of
// terminalService.ts (P3.9) so the session store, output routing, and lifecycle
// getters live apart from the PTY/AI spawning logic. Depends only on the DB and
// logger — no back-reference to the spawners — so there is no import cycle.
// terminalService.ts re-exports everything here, so `termService.*` consumers
// are unaffected.

// ── Types ──────────────────────────────────────────────────────

// Maximum scrollback to retain per session (in characters).
// This allows reconnecting clients to see recent terminal output.
export const MAX_SCROLLBACK_CHARS = 100_000;

export interface PtySession {
  id: string;
  proc: PtyHandle | null;
  cwd: string;
  type: TerminalSessionType;
  projectId?: string;
  taskId?: string;
  name?: string;
  alive: boolean;
  ws: any | null; // active WebSocket connection
  outputBuffer: string[]; // buffers output until WS attaches
  exitBuffer: number | null; // buffers exit code until WS attaches
  scrollback: string; // rolling scrollback buffer for reconnection
  // O6: knowledge artifacts injected into this session's prompt, persisted on
  // the run row written when the session exits. Empty when none grounded.
  groundedArtifacts?: GroundedArtifact[];
  // claude-interactive: selected model + the pinned Claude session id, surfaced
  // to the client so the tab header shows them and a picker can resume.
  model?: string;
  claudeSessionId?: string;
  // Append-only transcript stream (Claude/AI sessions only) so output survives
  // after the session exits and its scrollback is dropped.
  transcriptStream?: import("node:fs").WriteStream | null;
}

// ── Safe environment ───────────────────────────────────────────

export const SAFE_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERPROFILE",
  "USER",
  "USERNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "NODE_ENV",
  "EDITOR",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PSModulePath",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "PROGRAMDATA",
]);

export function getSafeEnv(): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value && (SAFE_ENV_KEYS.has(key) || key.startsWith("LC_"))) {
      safe[key] = value;
    }
  }
  return safe;
}

// ── Session store ──────────────────────────────────────────────

export const sessions = new Map<string, PtySession>();
export let idCounter = 0;

export function generateId(): string {
  return `term-${++idCounter}-${Date.now().toString(36)}`;
}

/** Reset id counter (for testing) */
export function _resetIdCounter(): void {
  idCounter = 0;
}

// Cryptographically-random session id (unguessable → resists WS hijack).
// Clients always use this server-issued id, so no client change needed.
export function generateSessionId(): string {
  return `term-${crypto.randomUUID()}`;
}

// Cap on concurrent live sessions to prevent unbounded resource use.
export const MAX_LIVE_SESSIONS = 50;

// Max bytes buffered per slow WS before we skip sending (backpressure guard).
const WS_BACKPRESSURE_LIMIT = 1_000_000;

// ── Resolve CWD from projectId or fallback ─────────────────────

export function resolveCwd(projectId?: string): string {
  if (projectId) {
    const db = getDb();
    const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as any;
    if (project) return project.path;
  }
  return process.cwd();
}

// ── Output routing: send to WS or buffer ───────────────────────

// Skip sends when a slow client's socket has too much buffered, so output
// from a fast PTY can't make the server buffer unbounded memory.
function wsBackpressured(ws: any): boolean {
  const buffered = ws?.bufferedAmount;
  return typeof buffered === "number" && buffered > WS_BACKPRESSURE_LIMIT;
}

export function emitData(session: PtySession, data: string) {
  // Always append to scrollback for reconnection support
  session.scrollback += data;
  if (session.scrollback.length > MAX_SCROLLBACK_CHARS) {
    session.scrollback = session.scrollback.slice(-MAX_SCROLLBACK_CHARS);
  }

  // Persist to the on-disk transcript (Claude/AI sessions set this stream).
  if (session.transcriptStream) {
    try {
      session.transcriptStream.write(data);
    } catch {
      /* stream closed/errored — scrollback still has recent output */
    }
  }

  if (session.ws && session.ws.readyState === 1) {
    // Drop chunk if the socket is congested — scrollback still has it for replay.
    if (wsBackpressured(session.ws)) return;
    session.ws.send(JSON.stringify({ type: "output", data }));
  } else {
    session.outputBuffer.push(data);
    // Cap detached buffer so it can't grow unbounded with no WS attached.
    let total = 0;
    for (let i = session.outputBuffer.length - 1; i >= 0; i--) {
      total += session.outputBuffer[i].length;
      if (total > MAX_SCROLLBACK_CHARS) {
        session.outputBuffer.splice(0, i);
        break;
      }
    }
  }
}

export function emitExit(session: PtySession, exitCode: number) {
  if (session.ws && session.ws.readyState === 1) {
    session.ws.send(JSON.stringify({ type: "exit", exitCode }));
  } else {
    session.exitBuffer = exitCode;
  }
}

// ── Session lifecycle: lookup / write / resize / kill / WS attach ──

export function listSessions(projectId?: string): PtySession[] {
  const all = Array.from(sessions.values());
  if (projectId) return all.filter((s) => s.projectId === projectId);
  return all;
}

export function getSession(id: string): PtySession | undefined {
  return sessions.get(id);
}

export function writeToSession(id: string, data: string): boolean {
  const session = sessions.get(id);
  if (!session?.alive || !session.proc) return false;
  try {
    session.proc.write(data);
    return true;
  } catch (err) {
    log("warn", "terminal", `Write failed for ${id}: ${String(err)}`);
    return false;
  }
}

export function resizeSession(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session?.alive || !session.proc) return false;
  try {
    session.proc.resize(cols, rows);
    return true;
  } catch (err) {
    log("warn", "terminal", `Resize failed for ${id}: ${String(err)}`);
    return false;
  }
}

export function killSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.proc?.kill();
  } catch {}
  // Close the WebSocket so the client knows immediately
  try {
    if (session.ws && session.ws.readyState === 1) {
      session.ws.send(JSON.stringify({ type: "exit", exitCode: 0 }));
      session.ws.close();
    }
  } catch {}
  session.alive = false;
  sessions.delete(id);
  log("info", "terminal", `Session killed: ${id}`);
  return true;
}

export function attachWs(id: string, ws: any): boolean {
  const session = sessions.get(id);
  if (!session) return false;

  // Replace old WS connection (allows reconnection)
  session.ws = ws;

  // Send scrollback history so reconnecting clients see previous output
  if (session.scrollback.length > 0 && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "output", data: session.scrollback }));
  }

  // Flush buffered output that arrived before WS connected
  if (session.outputBuffer.length > 0) {
    for (const data of session.outputBuffer) {
      if (ws.readyState === 1 && !wsBackpressured(ws)) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    }
    session.outputBuffer = [];
  }

  // Flush buffered exit
  if (session.exitBuffer !== null) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "exit", exitCode: session.exitBuffer }));
    }
    session.exitBuffer = null;
  }

  return true;
}

export function detachWs(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.ws = null;
}
