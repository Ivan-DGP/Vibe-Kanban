import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { getDb } from "../db";
import { log } from "../lib/logger";
import type { TerminalSessionType } from "@vibe-kanban/shared";

// ── Types ──────────────────────────────────────────────────────

interface PtySession {
  id: string;
  process: any; // node-pty IPty or AiResolveHandle
  cwd: string;
  type: TerminalSessionType;
  projectId?: string;
  taskId?: string;
  alive: boolean;
  ws: any | null; // active WebSocket connection
  outputBuffer: string[]; // buffers output until WS attaches
  exitBuffer: number | null; // buffers exit code until WS attaches
}

interface AiResolveHandle {
  kill: () => void;
  write?: undefined;
  resize?: undefined;
}

// ── PTY module (optional dep) ──────────────────────────────────

let ptyModule: any = null;

async function getPty() {
  if (ptyModule) return ptyModule;
  try {
    ptyModule = await import("node-pty");
    return ptyModule;
  } catch (err) {
    log("warn", "terminal", "node-pty not available, terminal will be limited", { error: String(err) });
    return null;
  }
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

// ── AI Resolve subprocess (bypasses ConPTY) ────────────────────

async function spawnAiResolve(
  session: PtySession,
  prompt: string,
  safeEnv: Record<string, string>,
): Promise<void> {
  const ts = Date.now();
  const tmpFile = nodePath.join(os.tmpdir(), `vk-resolve-${ts}.txt`);
  fs.writeFileSync(tmpFile, prompt, "utf-8");
  log("info", "terminal", `AI resolve: wrote prompt (${prompt.length} bytes) to ${tmpFile}`);

  let claudeCmd = "claude";
  try {
    const which = Bun.spawnSync(["where", "claude"], { env: safeEnv });
    if (which.exitCode === 0) {
      claudeCmd = which.stdout.toString().trim().split(/\r?\n/)[0];
    }
  } catch {}

  log("info", "terminal", `AI resolve [${session.id}]: spawning ${claudeCmd}`);

  const promptBytes = fs.readFileSync(tmpFile);
  const proc = Bun.spawn(
    [claudeCmd, "--dangerously-skip-permissions", "-p"],
    {
      cwd: session.cwd,
      env: { ...safeEnv, CI: "true", NO_COLOR: "1", TERM: "dumb" },
      stdin: new Blob([promptBytes]),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  // Stream stdout
  (async () => {
    try {
      const reader = proc.stdout.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        emitData(session, dec.decode(value));
      }
    } catch (e) {
      log("warn", "terminal", `AI resolve stdout error [${session.id}]: ${String(e)}`);
    }
  })();

  // Stream stderr
  (async () => {
    try {
      const reader = proc.stderr.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        emitData(session, dec.decode(value));
      }
    } catch (e) {
      log("warn", "terminal", `AI resolve stderr error [${session.id}]: ${String(e)}`);
    }
  })();

  proc.exited.then((exitCode) => {
    log("info", "terminal", `AI resolve [${session.id}]: exited with code ${exitCode}`);
    session.alive = false;
    emitExit(session, exitCode ?? 1);
    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch {}
  }).catch(() => {});

  session.process = {
    kill: () => { try { proc.kill(); } catch {} },
  } as AiResolveHandle;
}

// ── Public API ─────────────────────────────────────────────────

export async function isAvailable(): Promise<boolean> {
  const pty = await getPty();
  return pty !== null;
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
    process: null,
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

  // AI Resolve: bypass ConPTY, use Bun.spawn directly
  if (opts.type === "ai-resolve" && opts.prompt) {
    await spawnAiResolve(session, opts.prompt, safeEnv);
    log("info", "terminal", `Session created: ${id}`, { type: "ai-resolve" });
    return session;
  }

  // ── Interactive shell via Bun.spawn ──────────────────────────
  // node-pty's ConPTY socket closes prematurely on Bun (ERR_SOCKET_CLOSED),
  // so we use Bun.spawn with piped stdin/stdout for all interactive sessions.
  const db = getDb();
  const shellSetting = db.prepare("SELECT value FROM settings WHERE key = 'terminalShell'").get() as any;
  let shell = process.platform === "win32" ? "cmd.exe" : (process.env.SHELL || "/bin/bash");
  if (shellSetting) {
    try {
      const parsed = JSON.parse(shellSetting.value);
      const shellMap: Record<string, string> = {
        powershell: "powershell.exe",
        cmd: "cmd.exe",
        bash: "bash",
      };
      if (shellMap[parsed]) shell = shellMap[parsed];
    } catch {}
  }

  const shellArgs = shell === "cmd.exe" ? ["/D"] : [];

  const proc = Bun.spawn([shell, ...shellArgs], {
    cwd,
    env: safeEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Stream stdout
  (async () => {
    try {
      const reader = proc.stdout.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        emitData(session, dec.decode(value));
      }
    } catch (e) {
      log("warn", "terminal", `Shell stdout error [${id}]: ${String(e)}`);
    }
  })();

  // Stream stderr
  (async () => {
    try {
      const reader = proc.stderr.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        emitData(session, dec.decode(value));
      }
    } catch (e) {
      log("warn", "terminal", `Shell stderr error [${id}]: ${String(e)}`);
    }
  })();

  // Handle exit
  proc.exited.then((exitCode) => {
    log("info", "terminal", `Shell [${id}]: exited with code ${exitCode}`);
    session.alive = false;
    emitExit(session, exitCode ?? 0);
    sessions.delete(id);
  }).catch(() => {});

  // Process handle with write support
  session.process = {
    kill: () => { try { proc.kill(); } catch {} },
    write: (data: string) => {
      try {
        proc.stdin.write(new TextEncoder().encode(data));
        proc.stdin.flush();
      } catch (e) {
        log("warn", "terminal", `Shell stdin write error [${id}]: ${String(e)}`);
      }
    },
  };

  // Auto-run dev command
  if (opts.type === "dev" && opts.devCommand) {
    const safeDevCommands = /^(bun|npm|yarn|pnpm|npx|node)\s+(run\s+)?(dev|start|serve)\s*$/;
    if (safeDevCommands.test(opts.devCommand.trim())) {
      session.process.write(opts.devCommand + "\r\n");
    }
  }

  log("info", "terminal", `Session created: ${id}`, { type: opts.type });
  return session;
}

export function writeToSession(id: string, data: string): boolean {
  const session = sessions.get(id);
  if (!session?.alive || !session.process?.write) {
    return false;
  }
  try {
    session.process.write(data);
    return true;
  } catch (err) {
    log("warn", "terminal", `Write failed for ${id}: ${String(err)}`);
    return false;
  }
}

export function resizeSession(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session?.alive) return false;
  // Bun.spawn doesn't support resize (no PTY), silently ignore
  if (!session.process?.resize) return true;
  try {
    session.process.resize(cols, rows);
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
    session.process?.kill?.();
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
  // Output will now buffer again until a new WS attaches
}
