import { getDb } from "../db";
import { log } from "../lib/logger";
import { buildAiResolvePromptWithGrounding, buildAiTestPrompt } from "./aiResolvePrompt";
import { spawnPty as runtimeSpawnPty, spawnProcessSync } from "../lib/runtime";
import * as tmux from "./tmuxBackend";
import { parseRateLimit, isAutoResumeEnabled, getResumeFallbackMs } from "./headlessClaude";
import type { PtyHandle } from "../lib/runtime";
import type {
  TerminalSessionType,
  BatchResolveStatus,
  GroundedArtifact,
} from "@vibe-kanban/shared";
import type { Task } from "@vibe-kanban/shared";

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

// ── Branch checkout helper ────────────────────────────────────

async function checkoutBranch(
  cwd: string,
  branch: string,
): Promise<{ ok: boolean; error?: string }> {
  const { spawn: spawnCmd } = await import("../lib/spawn");
  // Check current branch — skip if already on target
  const currentResult = await spawnCmd(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  if (currentResult.exitCode === 0 && currentResult.stdout.trim() === branch) {
    return { ok: true };
  }
  // Try switching to existing branch
  const result = await spawnCmd(["git", "checkout", branch], { cwd });
  if (result.exitCode === 0) return { ok: true };
  // Branch doesn't exist — create it
  const createResult = await spawnCmd(["git", "checkout", "-b", branch], { cwd });
  if (createResult.exitCode === 0) return { ok: true };
  return { ok: false, error: createResult.stderr };
}

// ── Interactive shell via PTY (Bun or node-pty) ────────────────

// ── Terminal-session metadata persistence (for restart survival) ──
//
// Shell/dev/claude-ai sessions run inside tmux (see tmuxBackend), so the shell
// survives a server restart. We persist just enough metadata to re-list and
// re-attach them on boot; the row is deleted when the session is explicitly
// killed or its shell exits. AI-resolve/ai-test sessions are ephemeral runs and
// are NOT persisted.

function persistTerminalRow(s: PtySession): void {
  try {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO terminal_sessions (id, type, projectId, taskId, name, cwd, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.id,
        s.type,
        s.projectId ?? null,
        s.taskId ?? null,
        s.name ?? null,
        s.cwd,
        new Date().toISOString(),
      );
  } catch (e) {
    log("warn", "terminal", `Failed to persist terminal session ${s.id}: ${String(e)}`);
  }
}

function deleteTerminalRow(id: string): void {
  try {
    getDb().prepare("DELETE FROM terminal_sessions WHERE id = ?").run(id);
  } catch {
    /* table may not exist yet / already gone */
  }
}

// Wire a shell PTY's data/exit handlers. With tmux, the attach-client PTY can
// exit while the tmux SESSION lives on (a bare detach); only a vanished tmux
// session counts as a real shell exit.
function wireShellPty(
  session: PtySession,
  pty: PtyHandle,
  isTmux: boolean,
  safeEnv: Record<string, string>,
): void {
  const { id } = session;
  pty.onData((data) => emitData(session, data));
  pty.onExit((exitCode) => {
    if (isTmux && tmux.tmuxHasSession(id, safeEnv)) {
      // Client detached but the tmux session is still alive — keep the session
      // around so a later WS connect can re-attach to it.
      session.proc = null;
      return;
    }
    log("info", "terminal", `Shell [${id}]: exited with code ${exitCode}`);
    session.alive = false;
    session.proc = null;
    emitExit(session, exitCode ?? 0);
    if (isTmux) {
      tmux.tmuxKillSession(id, safeEnv);
      deleteTerminalRow(id);
    }
    // Remove exited session from the map so it doesn't leak.
    sessions.delete(id);
  });
  session.proc = pty;
}

function spawnShellPty(
  session: PtySession,
  shell: string,
  shellArgs: string[],
  safeEnv: Record<string, string>,
  opts: CreateSessionOptions,
): void {
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  // Only use tmux when it's available AND the session actually gets created —
  // fall back to a raw PTY otherwise so terminals never fail to open.
  const useTmux =
    tmux.isTmuxAvailable(safeEnv) &&
    tmux.tmuxEnsureSession(session.id, shell, shellArgs, safeEnv, cols, rows);

  const pty = useTmux
    ? runtimeSpawnPty("tmux", tmux.tmuxAttachArgs(session.id), {
        cwd: session.cwd,
        env: tmux.clientEnv(safeEnv),
        cols,
        rows,
      })
    : runtimeSpawnPty(shell, shellArgs, { cwd: session.cwd, env: safeEnv, cols, rows });

  if (useTmux) persistTerminalRow(session);
  wireShellPty(session, pty, useTmux, safeEnv);
}

// Lazily (re-)attach a tmux PTY to a session that has no live proc — used after
// a server restart, when the session exists in tmux but not as a child process.
function ensureAttached(session: PtySession): void {
  if (session.proc || !session.alive) return;
  const safeEnv = getSafeEnv();
  if (!tmux.isTmuxAvailable(safeEnv) || !tmux.tmuxHasSession(session.id, safeEnv)) return;
  const pty = runtimeSpawnPty("tmux", tmux.tmuxAttachArgs(session.id), {
    cwd: session.cwd,
    env: tmux.clientEnv(safeEnv),
    cols: 80,
    rows: 24, // the client sends a resize immediately on connect
  });
  wireShellPty(session, pty, true, safeEnv);
}

/**
 * Rebuild the in-memory session map from persisted rows whose tmux session is
 * still alive, so terminals survive a server restart. Stale rows (tmux gone)
 * are pruned; orphan tmux sessions we own but have no row for are killed. Call
 * once at startup, after the DB is migrated.
 */
export function restoreTerminalSessions(): void {
  const safeEnv = getSafeEnv();
  if (!tmux.isTmuxAvailable(safeEnv)) return;

  const live = new Set(tmux.tmuxListSessions(safeEnv));
  let rows: {
    id: string;
    type: TerminalSessionType;
    projectId: string | null;
    taskId: string | null;
    name: string | null;
    cwd: string;
  }[];
  try {
    rows = getDb()
      .prepare("SELECT id, type, projectId, taskId, name, cwd FROM terminal_sessions")
      .all() as typeof rows;
  } catch {
    return; // table not present yet
  }

  const known = new Set<string>();
  let restored = 0;
  for (const r of rows) {
    known.add(r.id);
    if (live.has(r.id)) {
      if (!sessions.has(r.id)) {
        sessions.set(r.id, {
          id: r.id,
          proc: null,
          cwd: r.cwd,
          type: r.type,
          projectId: r.projectId ?? undefined,
          taskId: r.taskId ?? undefined,
          name: r.name ?? undefined,
          alive: true,
          ws: null,
          outputBuffer: [],
          exitBuffer: null,
          scrollback: "",
        });
        restored++;
      }
    } else {
      deleteTerminalRow(r.id); // tmux session gone — prune stale row
    }
  }

  // Kill orphan tmux sessions we own but can no longer reach (no row).
  for (const name of live) {
    if (name.startsWith(tmux.SESSION_PREFIX) && !known.has(name)) {
      tmux.tmuxKillSession(name, safeEnv);
    }
  }

  if (restored > 0) {
    log("info", "terminal", `Restored ${restored} terminal session(s) after restart`);
  }
}

// ── AI Resolve via PTY ──────────────────────────────────────────

export function resolveClaudeCmd(safeEnv: Record<string, string>): string {
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const result = spawnProcessSync([whichCmd, "claude"], { env: safeEnv });
    if (result.exitCode === 0) {
      return result.stdout.split(/\r?\n/)[0];
    }
  } catch {}
  return "claude";
}

// Distinctive Claude usage-limit phrasings — stricter than the generic detector so
// a task whose output merely mentions "rate limit" doesn't get mis-parked.
const PTY_LIMIT_RX =
  /(claude )?(ai )?usage limit reached|you'?ve reached your usage limit|your limit will reset at|\b5-?hour limit reached|limit reached\|\d{10}/i;

function spawnAiResolve(
  session: PtySession,
  prompt: string,
  safeEnv: Record<string, string>,
  opts: CreateSessionOptions,
): void {
  const { id } = session;
  const claudeCmd = resolveClaudeCmd(safeEnv);
  const autoResume = isAutoResumeEnabled();
  // A known session id we can later resume with `claude -p --resume <id>`. The CLI
  // never surfaces the auto-generated id, so we pin it up front.
  const claudeSessionId = crypto.randomUUID();
  const parkRunId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  log("info", "terminal", `AI resolve [${id}]: spawning ${claudeCmd} with prompt as argument`);

  const pty = runtimeSpawnPty(
    claudeCmd,
    ["--session-id", claudeSessionId, "--dangerously-skip-permissions", prompt],
    {
      cwd: session.cwd,
      env: safeEnv,
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
    },
  );

  // Watch the stream for a usage-limit hit so we can park + auto-resume instead of
  // ending the run. Interactive claude may sit at the prompt after the limit, so we
  // proactively kill it once detected (onExit then parks the run).
  let limitTail = "";
  let parked: { resumeAt: Date } | null = null;

  pty.onData((data) => {
    emitData(session, data);
    if (autoResume && !parked && session.taskId && session.projectId) {
      limitTail = (limitTail + data).slice(-4000);
      if (PTY_LIMIT_RX.test(limitTail)) {
        const rl = parseRateLimit(limitTail, "");
        parked = { resumeAt: rl.resumeAt ?? new Date(Date.now() + getResumeFallbackMs()) };
        emitData(
          session,
          "\r\n\x1b[33m⏸ Usage limit reached — Vibe Kanban will auto-resume this task when your window resets (see the task's AI Runs panel for the countdown).\x1b[0m\r\n",
        );
        try {
          pty.kill();
        } catch {
          /* already gone */
        }
      }
    }
  });

  pty.onExit((exitCode) => {
    log("info", "terminal", `AI resolve [${id}]: exited with code ${exitCode}`);
    session.alive = false;
    emitExit(session, exitCode ?? 1);

    // Record AI run result
    if (session.taskId && session.projectId) {
      try {
        const db = getDb();
        const grounded = JSON.stringify(session.groundedArtifacts ?? []);

        // Usage limit → park as 'waiting_limit'. The resume scheduler continues the
        // same session headlessly (`claude -p --resume <id>`) when the window resets.
        if (parked) {
          db.prepare(
            `INSERT INTO task_ai_runs
               (id, taskId, projectId, sessionId, profile, complexity, status, startedAt,
                resumeAt, resumeReason, resumeAttempts, runMode, groundedArtifacts)
             VALUES (?, ?, ?, ?, 'auto', 'medium', 'waiting_limit', ?, ?, 'usage-limit', 1, 'in_place', ?)`,
          ).run(
            parkRunId,
            session.taskId,
            session.projectId,
            claudeSessionId,
            startedAt,
            parked.resumeAt.toISOString(),
            grounded,
          );
          log("info", "terminal", `AI resolve [${id}]: parked for usage-limit auto-resume`, {
            runId: parkRunId,
            resumeAt: parked.resumeAt.toISOString(),
          });
          sessions.delete(id);
          return; // do NOT chain a test on a paused run
        }

        const code = exitCode ?? 1;
        const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get(session.taskId) as any;
        const success = task?.status === "done" || code === 0;
        db.prepare(
          `INSERT INTO task_ai_runs (id, taskId, projectId, sessionId, profile, complexity, exitCode, success, groundedArtifacts)
           VALUES (?, ?, ?, ?, 'auto', 'medium', ?, ?, ?)`,
        ).run(
          crypto.randomUUID(),
          session.taskId,
          session.projectId,
          session.id,
          code,
          success ? 1 : 0,
          grounded,
        );

        // Chain AI Test session if resolve succeeded and autoTest is enabled
        if (success && session.taskId && session.projectId && opts.autoTest !== false) {
          chainAiTest(session.taskId, session.projectId, session.cwd, safeEnv, opts).catch((e) => {
            log("warn", "terminal", `Failed to chain AI test: ${e}`);
          });
        }
      } catch (e) {
        log("warn", "terminal", `Failed to record AI run: ${e}`);
      }
    }

    sessions.delete(id);
  });

  session.proc = pty;
}

// ── AI Test via PTY (chained after AI Resolve) ──────────────────

async function chainAiTest(
  taskId: string,
  projectId: string,
  cwd: string,
  safeEnv: Record<string, string>,
  parentOpts: CreateSessionOptions,
): Promise<void> {
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
  if (!task) return;

  // Don't test if task was already marked done by the resolve session
  // (the test agent will re-evaluate and set done only if tests pass)
  const port = parseInt(process.env.PORT || "3001", 10);

  log("info", "terminal", `Chaining AI test for task "${task.title}"`);

  // Set task back to in_progress so test agent controls the done transition
  const ts = new Date().toISOString();
  db.prepare(
    "UPDATE tasks SET status = 'in_progress', doneAt = NULL, updatedAt = ? WHERE id = ?",
  ).run(ts, taskId);

  const prompt = await buildAiTestPrompt(task, projectId, port);

  await createSession({
    type: "ai-test",
    projectId,
    taskId,
    name: `Test: ${task.title}`,
    prompt,
    cols: parentOpts.cols,
    rows: parentOpts.rows,
    autoTest: false, // prevent infinite chain
  });
}

function spawnAiTest(
  session: PtySession,
  prompt: string,
  safeEnv: Record<string, string>,
  opts: CreateSessionOptions,
): void {
  const { id } = session;
  const claudeCmd = resolveClaudeCmd(safeEnv);

  log("info", "terminal", `AI test [${id}]: spawning ${claudeCmd}`);

  const pty = runtimeSpawnPty(claudeCmd, ["--dangerously-skip-permissions", prompt], {
    cwd: session.cwd,
    env: safeEnv,
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
  });

  pty.onData((data) => emitData(session, data));
  pty.onExit((exitCode) => {
    log("info", "terminal", `AI test [${id}]: exited with code ${exitCode}`);
    session.alive = false;
    emitExit(session, exitCode ?? 1);

    // Record test run
    if (session.taskId && session.projectId) {
      try {
        const db = getDb();
        const code = exitCode ?? 1;
        const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get(session.taskId) as any;
        const success = task?.status === "done" || code === 0;
        db.prepare(
          `INSERT INTO task_ai_runs (id, taskId, projectId, sessionId, profile, complexity, exitCode, success)
           VALUES (?, ?, ?, ?, 'test', 'medium', ?, ?)`,
        ).run(
          crypto.randomUUID(),
          session.taskId,
          session.projectId,
          session.id,
          code,
          success ? 1 : 0,
        );
      } catch (e) {
        log("warn", "terminal", `Failed to record AI test run: ${e}`);
      }
    }

    sessions.delete(id);
  });

  session.proc = pty;
}

// ── Public API ─────────────────────────────────────────────────

export async function isAvailable(): Promise<boolean> {
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
  branch?: string;
  devCommand?: string;
  autoTest?: boolean;
  // O6: knowledge artifacts grounded into the prompt for this AI-resolve
  // session, threaded through to the persisted run row.
  groundedArtifacts?: GroundedArtifact[];
}

export async function createSession(opts: CreateSessionOptions): Promise<PtySession> {
  // Enforce cap on concurrent live sessions
  let liveCount = 0;
  for (const s of sessions.values()) if (s.alive) liveCount++;
  if (liveCount >= MAX_LIVE_SESSIONS) {
    throw new Error(`Too many active terminal sessions (max ${MAX_LIVE_SESSIONS})`);
  }

  const id = generateSessionId();
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
    groundedArtifacts: opts.groundedArtifacts,
  };

  sessions.set(id, session);

  // Checkout target branch before AI resolve
  if (opts.type === "ai-resolve" && opts.branch) {
    const checkout = await checkoutBranch(cwd, opts.branch);
    if (!checkout.ok) {
      log("warn", "terminal", `Branch checkout failed for "${opts.branch}": ${checkout.error}`);
    }
  }

  // AI Resolve: interactive PTY running claude CLI
  if (opts.type === "ai-resolve" && opts.prompt) {
    spawnAiResolve(session, opts.prompt, safeEnv, opts);
    log("info", "terminal", `Session created: ${id}`, {
      type: "ai-resolve",
      backend: "bun-terminal",
    });
    return session;
  }

  // AI Test: interactive PTY running claude CLI for testing
  if (opts.type === "ai-test" && opts.prompt) {
    spawnAiTest(session, opts.prompt, safeEnv, opts);
    log("info", "terminal", `Session created: ${id}`, { type: "ai-test", backend: "bun-terminal" });
    return session;
  }

  // ── Resolve shell from settings ───────────────────────────────
  const db = getDb();
  const shellSetting = db
    .prepare("SELECT value FROM settings WHERE key = 'terminalShell'")
    .get() as any;
  const isWindows = process.platform === "win32";
  let shell = isWindows ? "cmd.exe" : process.env.SHELL || "/bin/bash";
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

  spawnShellPty(session, shell, shellArgs, safeEnv, opts);

  // Auto-run dev command
  if (opts.type === "dev" && opts.devCommand) {
    const safeDevCommands = /^(bun|npm|yarn|pnpm|npx|node)\s+(run\s+)?(dev|start|serve)\s*$/;
    if (safeDevCommands.test(opts.devCommand.trim())) {
      session.proc?.write(opts.devCommand + "\r\n");
    }
  }

  log("info", "terminal", `Session created: ${id}`, { type: opts.type });
  return session;
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
    session.proc?.kill(); // detaches the tmux client (or kills a raw PTY)
  } catch {}
  // Explicit close means destroy the tmux session too, not just detach — so the
  // shell and its processes actually end, and the row is removed. No-op for raw
  // PTYs / ai-run sessions that were never persisted.
  const safeEnv = getSafeEnv();
  if (tmux.isTmuxAvailable(safeEnv)) tmux.tmuxKillSession(id, safeEnv);
  deleteTerminalRow(id);
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

  // After a server restart the session exists in tmux but has no live proc —
  // re-attach a tmux PTY now so input/output flow again. The tmux redraw of the
  // current screen arrives via onData and is forwarded to this WS.
  ensureAttached(session);

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

// ── Batch AI Resolve Queue ──────────────────────────────────

export let batchState: BatchResolveStatus = {
  state: "idle",
  totalTasks: 0,
  completedTasks: 0,
  taskResults: [],
};

export function getBatchResolveStatus(): BatchResolveStatus {
  return {
    ...batchState,
    activeTasks: [...(batchState.activeTasks ?? [])],
    taskResults: [...batchState.taskResults],
  };
}

export async function startBatchResolve(
  projectId: string,
  taskIds: string[],
  concurrency: number = 1,
  overrideBranch?: string,
): Promise<BatchResolveStatus> {
  if (batchState.state === "running") {
    throw new Error("A batch resolve is already running");
  }

  const db = getDb();
  const port = parseInt(process.env.PORT || "3001", 10);

  // Validate all tasks exist
  const tasks: Task[] = [];
  for (const id of taskIds) {
    const task = db
      .prepare("SELECT * FROM tasks WHERE id = ? AND projectId = ?")
      .get(id, projectId) as Task | undefined;
    if (task) tasks.push(task);
  }

  if (tasks.length === 0) {
    throw new Error("No valid tasks found");
  }

  const effectiveConcurrency = Math.max(1, Math.min(concurrency, 10));

  batchState = {
    state: "running",
    projectId,
    totalTasks: tasks.length,
    completedTasks: 0,
    concurrency: effectiveConcurrency,
    activeTasks: [],
    taskResults: [],
  };

  // Group tasks by branch for sequential branch processing
  const branchGroups = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const key = overrideBranch || task.branch || null;
    if (!branchGroups.has(key)) branchGroups.set(key, []);
    branchGroups.get(key)!.push(task);
  }

  // Process null-branch group first, then named branches
  const groups: [string | null, Task[]][] = [
    ...(branchGroups.has(null) ? [[null, branchGroups.get(null)!] as [null, Task[]]] : []),
    ...Array.from(branchGroups.entries()).filter(([k]) => k !== null),
  ];

  processQueueWithBranches(groups, projectId, port, effectiveConcurrency).catch((err) => {
    log("error", "terminal", `Batch resolve error: ${String(err)}`);
    batchState.state = "completed";
  });

  return getBatchResolveStatus();
}

async function processSingleTask(task: Task, projectId: string, port: number): Promise<void> {
  if (batchState.state === "cancelled") return;

  try {
    // Build prompt for this task, capturing the knowledge artifacts grounded
    // into it so the run row can persist them (O6).
    let prompt: string;
    let groundedArtifacts: GroundedArtifact[] = [];
    try {
      const built = await buildAiResolvePromptWithGrounding(task, projectId, port);
      prompt = built.prompt;
      groundedArtifacts = built.groundedArtifacts;
    } catch {
      const parts = [task.title];
      if (task.description) parts.push(task.description);
      if (task.prompt) parts.push(task.prompt);
      prompt = parts.join("\n\n");
    }

    // Update task status to in_progress
    const db = getDb();
    const ts = new Date().toISOString();
    db.prepare(
      "UPDATE tasks SET status = 'in_progress', inProgressAt = ?, updatedAt = ? WHERE id = ?",
    ).run(ts, ts, task.id);

    // Create the AI resolve session
    const session = await createSession({
      type: "ai-resolve",
      projectId,
      taskId: task.id,
      name: task.title,
      prompt,
      groundedArtifacts,
    });

    // Track active task
    batchState.activeTasks = batchState.activeTasks ?? [];
    batchState.activeTasks.push({ taskId: task.id, taskTitle: task.title, sessionId: session.id });

    // Keep legacy single-task fields updated (points to most recently started)
    batchState.currentTaskId = task.id;
    batchState.currentTaskTitle = task.title;
    batchState.currentSessionId = session.id;

    log(
      "info",
      "terminal",
      `Batch resolve: started task "${task.title}" (${batchState.completedTasks + 1}/${batchState.totalTasks})`,
    );

    // Wait for task completion (either session exits or task marked done in DB)
    const exitCode = await waitForTaskCompletion(session.id, task.id);

    // Remove from active tasks
    batchState.activeTasks = (batchState.activeTasks ?? []).filter((t) => t.taskId !== task.id);

    batchState.taskResults.push({
      taskId: task.id,
      taskTitle: task.title,
      sessionId: session.id,
      exitCode: exitCode ?? undefined,
    });
    batchState.completedTasks++;

    log(
      "info",
      "terminal",
      `Batch resolve: completed task "${task.title}" with exit code ${exitCode}`,
    );
  } catch (err) {
    log(
      "error",
      "terminal",
      `Batch resolve: error processing task "${task.title}": ${String(err)}`,
    );
    batchState.activeTasks = (batchState.activeTasks ?? []).filter((t) => t.taskId !== task.id);
    batchState.taskResults.push({
      taskId: task.id,
      taskTitle: task.title,
      sessionId: batchState.currentSessionId ?? "",
      exitCode: -1,
    });
    batchState.completedTasks++;
  }
}

async function processQueueWithBranches(
  branchGroups: [string | null, Task[]][],
  projectId: string,
  port: number,
  concurrency: number,
): Promise<void> {
  const projectPath = resolveCwd(projectId);

  for (const [branch, tasks] of branchGroups) {
    if (batchState.state === "cancelled") break;

    // Checkout branch for this group
    if (branch) {
      const result = await checkoutBranch(projectPath, branch);
      if (!result.ok) {
        log(
          "error",
          "terminal",
          `Batch resolve: failed to checkout branch "${branch}": ${result.error}`,
        );
        // Mark all tasks in this group as failed
        for (const task of tasks) {
          batchState.taskResults.push({
            taskId: task.id,
            taskTitle: task.title,
            sessionId: "",
            exitCode: -1,
          });
          batchState.completedTasks++;
        }
        continue;
      }
      log(
        "info",
        "terminal",
        `Batch resolve: switched to branch "${branch}" for ${tasks.length} task(s)`,
      );
    }

    // Process tasks in this branch group with concurrency
    await processQueue(tasks, projectId, port, concurrency);
  }

  batchState.state = batchState.state === "cancelled" ? "cancelled" : "completed";
  batchState.currentTaskId = undefined;
  batchState.currentTaskTitle = undefined;
  batchState.currentSessionId = undefined;
  batchState.activeTasks = [];
  log("info", "terminal", `Batch resolve: all ${batchState.totalTasks} tasks completed`);
}

async function processQueue(
  tasks: Task[],
  projectId: string,
  port: number,
  concurrency: number = 1,
): Promise<void> {
  if (concurrency <= 1) {
    // Sequential processing (original behavior)
    for (const task of tasks) {
      if (batchState.state === "cancelled") {
        log("info", "terminal", "Batch resolve cancelled");
        break;
      }
      await processSingleTask(task, projectId, port);
    }
  } else {
    // Concurrent processing with a pool
    let index = 0;
    const next = async (): Promise<void> => {
      while (index < tasks.length && batchState.state !== "cancelled") {
        const task = tasks[index++];
        await processSingleTask(task, projectId, port);
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => next());
    await Promise.all(workers);
    if (batchState.state === "cancelled") {
      log("info", "terminal", "Batch resolve cancelled");
    }
  }
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
        const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as
          | { status: string }
          | undefined;
        if (task && task.status === "done") {
          log(
            "info",
            "terminal",
            `Batch resolve: task ${taskId} marked done in DB, killing session ${sessionId}`,
          );
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

  // Kill all active sessions
  for (const active of batchState.activeTasks ?? []) {
    killSession(active.sessionId);
  }
  // Also kill legacy current session if not in activeTasks
  if (batchState.currentSessionId) {
    killSession(batchState.currentSessionId);
  }

  log("info", "terminal", "Batch resolve: cancelled by user");
  return getBatchResolveStatus();
}
