import { getDb } from "../db";
import { log } from "../lib/logger";
import { buildAiResolvePrompt } from "./aiResolvePrompt";
import type { TerminalSessionType, BatchResolveStatus } from "@vibe-kanban/shared";
import type { Task } from "@vibe-kanban/shared";

// ── Types ──────────────────────────────────────────────────────

// Maximum scrollback to retain per session (in characters).
// This allows reconnecting clients to see recent terminal output.
const MAX_SCROLLBACK_CHARS = 100_000;

interface PtySession {
  id: string;
  proc: any; // Bun subprocess with terminal or piped I/O
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
  // Always append to scrollback for reconnection support
  session.scrollback += data;
  if (session.scrollback.length > MAX_SCROLLBACK_CHARS) {
    session.scrollback = session.scrollback.slice(-MAX_SCROLLBACK_CHARS);
  }

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

  log("info", "terminal", `AI resolve [${id}]: spawning ${claudeCmd} with prompt as argument`);

  // Pass the prompt directly as a CLI argument so Claude starts working immediately.
  // No need to paste + Enter — Claude CLI accepts: claude --dangerously-skip-permissions "prompt"
  const proc = Bun.spawn([claudeCmd, "--dangerously-skip-permissions", prompt], {
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
  name?: string;
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
    name: opts.name,
    alive: true,
    ws: null,
    outputBuffer: [],
    exitBuffer: null,
    scrollback: "",
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

// ── Batch AI Resolve Queue ──────────────────────────────────

let batchState: BatchResolveStatus = {
  state: "idle",
  totalTasks: 0,
  completedTasks: 0,
  taskResults: [],
};

export function getBatchResolveStatus(): BatchResolveStatus {
  return { ...batchState, taskResults: [...batchState.taskResults] };
}

export async function startBatchResolve(projectId: string, taskIds: string[]): Promise<BatchResolveStatus> {
  if (batchState.state === "running") {
    throw new Error("A batch resolve is already running");
  }

  const db = getDb();
  const port = parseInt(process.env.PORT || "3001", 10);

  // Validate all tasks exist
  const tasks: Task[] = [];
  for (const id of taskIds) {
    const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND projectId = ?").get(id, projectId) as Task | undefined;
    if (task) tasks.push(task);
  }

  if (tasks.length === 0) {
    throw new Error("No valid tasks found");
  }

  batchState = {
    state: "running",
    projectId,
    totalTasks: tasks.length,
    completedTasks: 0,
    taskResults: [],
  };

  // Process tasks sequentially in the background
  processQueue(tasks, projectId, port).catch((err) => {
    log("error", "terminal", `Batch resolve error: ${String(err)}`);
    batchState.state = "completed";
  });

  return getBatchResolveStatus();
}

async function processQueue(tasks: Task[], projectId: string, port: number): Promise<void> {
  for (const task of tasks) {
    if (batchState.state === "cancelled") {
      log("info", "terminal", "Batch resolve cancelled");
      return;
    }

    try {
      // Build prompt for this task
      let prompt: string;
      try {
        prompt = await buildAiResolvePrompt(task, projectId, port);
      } catch {
        const parts = [task.title];
        if (task.description) parts.push(task.description);
        if (task.prompt) parts.push(task.prompt);
        prompt = parts.join("\n\n");
      }

      // Update batch state for this task before creating session
      batchState.currentTaskId = task.id;
      batchState.currentTaskTitle = task.title;

      // Update task status to in_progress
      const db = getDb();
      const ts = new Date().toISOString();
      db.prepare("UPDATE tasks SET status = 'in_progress', inProgressAt = ?, updatedAt = ? WHERE id = ?").run(ts, ts, task.id);

      // Create the AI resolve session
      const session = await createSession({
        type: "ai-resolve",
        projectId,
        taskId: task.id,
        name: task.title,
        prompt,
      });

      batchState.currentSessionId = session.id;

      log("info", "terminal", `Batch resolve: started task "${task.title}" (${batchState.completedTasks + 1}/${batchState.totalTasks})`);

      // Wait for task completion (either session exits or task marked done in DB)
      const exitCode = await waitForTaskCompletion(session.id, task.id);

      batchState.taskResults.push({
        taskId: task.id,
        taskTitle: task.title,
        sessionId: session.id,
        exitCode: exitCode ?? undefined,
      });
      batchState.completedTasks++;

      log("info", "terminal", `Batch resolve: completed task "${task.title}" with exit code ${exitCode}`);
    } catch (err) {
      log("error", "terminal", `Batch resolve: error processing task "${task.title}": ${String(err)}`);
      batchState.taskResults.push({
        taskId: task.id,
        taskTitle: task.title,
        sessionId: batchState.currentSessionId ?? "",
        exitCode: -1,
      });
      batchState.completedTasks++;
    }
  }

  batchState.state = "completed";
  batchState.currentTaskId = undefined;
  batchState.currentTaskTitle = undefined;
  batchState.currentSessionId = undefined;
  log("info", "terminal", `Batch resolve: all ${batchState.totalTasks} tasks completed`);
}

function waitForTaskCompletion(sessionId: string, taskId: string): Promise<number | null> {
  return new Promise((resolve) => {
    const check = () => {
      // Check if session exited naturally
      const session = sessions.get(sessionId);
      if (!session) {
        resolve(0);
        return;
      }
      if (!session.alive) {
        resolve(session.exitBuffer ?? 0);
        return;
      }

      // Check if task status changed to "done" in DB (Claude finished the work)
      try {
        const db = getDb();
        const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
        if (task && task.status === "done") {
          log("info", "terminal", `Batch resolve: task ${taskId} marked done in DB, killing session ${sessionId}`);
          killSession(sessionId);
          resolve(0);
          return;
        }
      } catch {}

      // Check if batch was cancelled
      if (batchState.state === "cancelled") {
        resolve(-1);
        return;
      }

      setTimeout(check, 3000);
    };
    // Start checking after a delay to let Claude CLI initialize
    setTimeout(check, 5000);
  });
}

export function cancelBatchResolve(): BatchResolveStatus {
  if (batchState.state !== "running") {
    return getBatchResolveStatus();
  }

  batchState.state = "cancelled";

  // Kill the current session if running
  if (batchState.currentSessionId) {
    killSession(batchState.currentSessionId);
  }

  log("info", "terminal", "Batch resolve: cancelled by user");
  return getBatchResolveStatus();
}
