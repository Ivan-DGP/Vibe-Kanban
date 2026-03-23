import { getDb } from "../db";
import { log } from "../lib/logger";
import type { TerminalSessionType } from "@vibe-kanban/shared";

// ── Types ──────────────────────────────────────────────────────

interface PtySession {
  id: string;
  proc: any; // Bun subprocess with terminal or piped I/O
  cwd: string;
  type: TerminalSessionType;
  projectId?: string;
  taskId?: string;
  alive: boolean;
  ws: any | null; // active WebSocket connection
  outputBuffer: string[]; // buffers output until WS attaches
  exitBuffer: number | null; // buffers exit code until WS attaches
}

// ── Safe environment ───────────────────────────────────────────

const SAFE_ENV_KEYS = new Set([
  "PATH", "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE",
  "USER", "USERNAME", "SHELL", "TERM", "LANG", "LC_ALL",
  "TMPDIR", "TEMP", "TMP", "NODE_ENV", "EDITOR",
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PSModulePath",
  "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMDATA",
]);

function getSafeEnv(): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value && (SAFE_ENV_KEYS.has(key) || key.startsWith("LC_"))) {
      safe[key] = value;
    }
  }
  return safe;
}

// ── Session store ──────────────────────────────────────────────

const sessions = new Map<string, PtySession>();
let idCounter = 0;

function generateId(): string {
  return `term-${++idCounter}-${Date.now().toString(36)}`;
}

// ── Resolve CWD from projectId or fallback ─────────────────────

function resolveCwd(projectId?: string): string {
  if (projectId) {
    const db = getDb();
    const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as any;
    if (project) return project.path;
  }
  return process.cwd();
}

// ── Output routing: send to WS or buffer ───────────────────────

function emitData(session: PtySession, data: string) {
  if (session.ws && session.ws.readyState === 1) {
    session.ws.send(JSON.stringify({ type: "output", data }));
  } else {
    session.outputBuffer.push(data);
  }
}

function emitExit(session: PtySession, exitCode: number) {
  if (session.ws && session.ws.readyState === 1) {
    session.ws.send(JSON.stringify({ type: "exit", exitCode }));
  } else {
    session.exitBuffer = exitCode;
  }
}

// ── Interactive shell via Bun's built-in terminal API ──────────

function spawnShellWithBunTerminal(
  session: PtySession,
  shell: string,
  shellArgs: string[],
  safeEnv: Record<string, string>,
  opts: CreateSessionOptions,
): void {
  const { id } = session;

  const proc = Bun.spawn([shell, ...shellArgs], {
    cwd: session.cwd,
    env: safeEnv,
    terminal: {
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      data(_terminal: any, data: Buffer) {
        emitData(session, data.toString());
      },
    },
  });

  proc.exited.then((exitCode: number) => {
    log("info", "terminal", `Shell [${id}]: exited with code ${exitCode}`);
    session.alive = false;
    emitExit(session, exitCode ?? 0);
    sessions.delete(id);
  }).catch(() => {});

  session.proc = proc;
}

// ── AI Resolve via Bun terminal PTY ─────────────────────────────

function resolveClaudeCmd(safeEnv: Record<string, string>): string {
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const result = Bun.spawnSync([whichCmd, "claude"], { env: safeEnv });
    if (result.exitCode === 0) {
      return result.stdout.toString().trim().split(/\r?\n/)[0];
    }
  } catch {}
  return "claude";
}

function spawnAiResolve(
  session: PtySession,
  prompt: string,
  safeEnv: Record<string, string>,
  opts: CreateSessionOptions,
): void {
  const { id } = session;
  const claudeCmd = resolveClaudeCmd(safeEnv);

  log("info", "terminal", `AI resolve [${id}]: spawning ${claudeCmd} with PTY`);

  const proc = Bun.spawn([claudeCmd, "--dangerously-skip-permissions"], {
    cwd: session.cwd,
    env: safeEnv,
    terminal: {
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      data(_terminal: any, data: Buffer) {
        emitData(session, data.toString());
      },
    },
  });

  proc.exited.then((exitCode: number) => {
    log("info", "terminal", `AI resolve [${id}]: exited with code ${exitCode}`);
    session.alive = false;
    emitExit(session, exitCode ?? 1);
    sessions.delete(id);
  }).catch(() => {});

  session.proc = proc;

  // Send the prompt as input after a short delay to let claude initialize
  setTimeout(() => {
    try {
      if (session.alive && proc.terminal) {
        proc.terminal.write(prompt + "\n");
      }
    } catch (e) {
      log("warn", "terminal", `AI resolve [${id}]: failed to write prompt: ${String(e)}`);
    }
  }, 1000);
}

// ── Public API ─────────────────────────────────────────────────

export async function isAvailable(): Promise<boolean> {
  // Bun's built-in terminal API is always available
  return true;
}

export function listSessions(projectId?: string): PtySession[] {
  const all = Array.from(sessions.values());
  if (projectId) return all.filter((s) => s.projectId === projectId);
  return all;
}

export function getSession(id: string): PtySession | undefined {
  return sessions.get(id);
}

export interface CreateSessionOptions {
  type: TerminalSessionType;
  projectId?: string;
  cols?: number;
  rows?: number;
  taskId?: string;
  prompt?: string;
  devCommand?: string;
}

export async function createSession(opts: CreateSessionOptions): Promise<PtySession> {
  const id = generateId();
  const cwd = resolveCwd(opts.projectId);
  const safeEnv = getSafeEnv();

  const session: PtySession = {
    id,
    proc: null,
    cwd,
    type: opts.type,
    projectId: opts.projectId,
    taskId: opts.taskId,
    alive: true,
    ws: null,
    outputBuffer: [],
    exitBuffer: null,
  };

  sessions.set(id, session);

  // AI Resolve: interactive PTY running claude CLI
  if (opts.type === "ai-resolve" && opts.prompt) {
    spawnAiResolve(session, opts.prompt, safeEnv, opts);
    log("info", "terminal", `Session created: ${id}`, { type: "ai-resolve", backend: "bun-terminal" });
    return session;
  }

  // ── Resolve shell from settings ───────────────────────────────
  const db = getDb();
  const shellSetting = db.prepare("SELECT value FROM settings WHERE key = 'terminalShell'").get() as any;
  const isWindows = process.platform === "win32";
  let shell = isWindows ? "cmd.exe" : (process.env.SHELL || "/bin/bash");
  if (shellSetting) {
    try {
      const parsed = JSON.parse(shellSetting.value);
      const shellMap: Record<string, string> = isWindows
        ? { powershell: "powershell.exe", cmd: "cmd.exe", bash: "bash" }
        : { bash: "bash", zsh: "zsh", sh: "sh" };
      if (shellMap[parsed]) shell = shellMap[parsed];
    } catch {}
  }

  const shellArgs = shell === "cmd.exe" ? ["/D"] : [];

  // Use Bun's built-in terminal API (real PTY, no node-pty needed)
  spawnShellWithBunTerminal(session, shell, shellArgs, safeEnv, opts);

  // Auto-run dev command
  if (opts.type === "dev" && opts.devCommand) {
    const safeDevCommands = /^(bun|npm|yarn|pnpm|npx|node)\s+(run\s+)?(dev|start|serve)\s*$/;
    if (safeDevCommands.test(opts.devCommand.trim())) {
      session.proc.terminal.write(opts.devCommand + "\r\n");
    }
  }

  log("info", "terminal", `Session created: ${id}`, { type: opts.type, backend: "bun-terminal" });
  return session;
}

export function writeToSession(id: string, data: string): boolean {
  const session = sessions.get(id);
  if (!session?.alive) return false;
  try {
    if (session.proc?.terminal) {
      // Bun built-in terminal
      session.proc.terminal.write(data);
      return true;
    }
    return false;
  } catch (err) {
    log("warn", "terminal", `Write failed for ${id}: ${String(err)}`);
    return false;
  }
}

export function resizeSession(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session?.alive) return false;
  try {
    if (session.proc?.terminal) {
      session.proc.terminal.resize(cols, rows);
      return true;
    }
    return false;
  } catch (err) {
    log("warn", "terminal", `Resize failed for ${id}: ${String(err)}`);
    return false;
  }
}

export function killSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.proc?.kill?.();
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

  // Flush buffered output that arrived before WS connected
  if (session.outputBuffer.length > 0) {
    for (const data of session.outputBuffer) {
      if (ws.readyState === 1) {
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
