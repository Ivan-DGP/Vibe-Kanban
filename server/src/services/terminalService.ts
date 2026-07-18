import { getDb } from "../db";
import { log } from "../lib/logger";
import { buildAiResolvePromptWithGrounding, buildAiTestPrompt } from "./aiResolvePrompt";
import { spawnPty as runtimeSpawnPty, spawnProcessSync } from "../lib/runtime";
import * as tmux from "./tmuxBackend";
import { parseRateLimit, isAutoResumeEnabled, getResumeFallbackMs } from "./headlessClaude";
import { openTranscript } from "./transcriptService";
import type {
  TerminalSessionType,
  BatchResolveStatus,
  GroundedArtifact,
  Task,
  AiAgent,
} from "@vibe-kanban/shared";
import {
  getConfiguredAgent,
  resolveAgentBinary,
  buildResolveArgs,
  isAgentAvailable,
} from "./aiAgent";
import {
  sessions,
  emitData,
  emitExit,
  generateSessionId,
  resolveCwd,
  getSafeEnv,
  killSession,
  MAX_LIVE_SESSIONS,
  persistTerminalRow,
  wireShellPty,
  type PtySession,
} from "./terminalRegistry";

// Re-export the session registry + I/O plumbing so `import * as termService`
// consumers (routes/terminal.ts, routes/terminalWs.ts) resolve every name here.
export * from "./terminalRegistry";

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

function spawnShellPty(
  session: PtySession,
  shell: string,
  shellArgs: string[],
  safeEnv: Record<string, string>,
  opts: CreateSessionOptions,
): void {
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  // Back the shell with a detached tmux session when possible, so it survives a
  // server restart. Only when tmux is available AND the session is actually
  // created — otherwise fall back to a raw PTY so terminals never fail to open.
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
  const agent: AiAgent = opts.agent ?? getConfiguredAgent();
  const startedAt = new Date().toISOString();

  session.transcriptStream = openTranscript(
    id,
    `\n===== ai-resolve · session ${id} · agent ${agent} · ${startedAt} =====\n`,
  );

  // Fail fast with a clear message when the chosen agent isn't installed, rather
  // than letting the PTY spawn fail opaquely.
  if (!isAgentAvailable(agent, safeEnv)) {
    log("error", "terminal", `AI resolve [${id}]: agent "${agent}" not found on PATH`);
    emitData(
      session,
      `\r\n\x1b[31m✖ AI resolver agent "${agent}" is not installed or not on PATH. ` +
        `Install it or pick a different agent in Settings.\x1b[0m\r\n`,
    );
    session.alive = false;
    session.transcriptStream?.end();
    if (session.taskId && session.projectId) {
      try {
        const db = getDb();
        db.prepare(
          `INSERT INTO task_ai_runs (id, taskId, projectId, sessionId, profile, complexity, exitCode, success, groundedArtifacts)
           VALUES (?, ?, ?, ?, 'auto', 'medium', 1, 0, ?)`,
        ).run(
          crypto.randomUUID(),
          session.taskId,
          session.projectId,
          session.id,
          JSON.stringify(session.groundedArtifacts ?? []),
        );
      } catch (e) {
        log("warn", "terminal", `Failed to record AI run: ${e}`);
      }
    }
    emitExit(session, 127);
    sessions.delete(id);
    return;
  }

  const agentCmd = resolveAgentBinary(agent, safeEnv);
  // Usage-limit auto-resume relies on pinning Claude's session id up front and
  // resuming it headlessly. OpenCode can't pin an id, so parking is claude-only.
  const autoResume = agent === "claude" && isAutoResumeEnabled();
  // A known session id we can later resume with `claude -p --resume <id>`. The CLI
  // never surfaces the auto-generated id, so we pin it up front (claude only).
  const claudeSessionId = crypto.randomUUID();
  const parkRunId = crypto.randomUUID();

  log("info", "terminal", `AI resolve [${id}]: spawning ${agentCmd} (${agent}) with prompt`);

  const pty = runtimeSpawnPty(agentCmd, buildResolveArgs(agent, { prompt, claudeSessionId }), {
    cwd: session.cwd,
    env: safeEnv,
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
  });

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
    session.transcriptStream?.end();
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

  session.transcriptStream = openTranscript(
    id,
    `\n===== ai-test · session ${id} · ${new Date().toISOString()} =====\n`,
  );

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
    session.transcriptStream?.end();
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

// ── Interactive Claude REPL via PTY ─────────────────────────────

// Models offered in the launcher. Free-form strings are also accepted (the CLI
// validates), but these are the vetted defaults surfaced in the UI.
export const CLAUDE_MODELS = ["default", "sonnet", "opus", "haiku"] as const;

/** Persist (or touch) a Claude session VK spawned so a picker can resume it. */
function recordClaudeSession(session: PtySession): void {
  if (!session.claudeSessionId) return; // `--continue` sessions have no known id
  try {
    const db = getDb();
    const now = new Date().toISOString();
    // Upsert: resuming an existing id just bumps lastUsedAt (+ model if changed).
    db.prepare(
      `INSERT INTO claude_sessions (id, projectId, taskId, model, cwd, title, createdAt, lastUsedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         lastUsedAt = excluded.lastUsedAt,
         model = COALESCE(excluded.model, claude_sessions.model),
         title = COALESCE(excluded.title, claude_sessions.title)`,
    ).run(
      session.claudeSessionId,
      session.projectId ?? null,
      session.taskId ?? null,
      session.model ?? null,
      session.cwd,
      session.name ?? null,
      now,
      now,
    );
  } catch (e) {
    log("warn", "terminal", `Failed to record claude session: ${e}`);
  }
}

/** List Claude sessions VK has spawned (most recently used first). */
export function listClaudeSessions(projectId?: string): any[] {
  try {
    const db = getDb();
    const rows = projectId
      ? db
          .prepare(
            "SELECT * FROM claude_sessions WHERE projectId = ? ORDER BY lastUsedAt DESC LIMIT 100",
          )
          .all(projectId)
      : db.prepare("SELECT * FROM claude_sessions ORDER BY lastUsedAt DESC LIMIT 100").all();
    return rows as any[];
  } catch {
    return [];
  }
}

// Spawn `claude` as a live interactive REPL (NO positional prompt) so the user
// types directly into it — distinct from ai-resolve (autonomous, one-shot).
function spawnClaudeInteractive(
  session: PtySession,
  safeEnv: Record<string, string>,
  opts: CreateSessionOptions,
): void {
  const { id } = session;
  const claudeCmd = resolveClaudeCmd(safeEnv);

  // Session selection: resume a specific id, continue the most recent, or start
  // fresh. New sessions pin a --session-id UUID so we always know the id for a
  // later resume/switch; --continue can't also pin one (CLI picks the latest).
  const args: string[] = [];
  if (opts.model && opts.model !== "default") {
    args.push("--model", opts.model);
    session.model = opts.model;
  }

  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
    session.claudeSessionId = opts.resumeSessionId;
  } else if (opts.continueLast) {
    args.push("--continue");
  } else {
    const newId = crypto.randomUUID();
    args.push("--session-id", newId);
    session.claudeSessionId = newId;
  }

  args.push("--dangerously-skip-permissions");

  log(
    "info",
    "terminal",
    `Claude interactive [${id}]: spawning ${claudeCmd} ${args.join(" ")} (cwd=${session.cwd})`,
  );

  session.transcriptStream = openTranscript(
    id,
    `\n===== claude-interactive · session ${id}` +
      `${session.model ? " · model " + session.model : ""}` +
      `${session.claudeSessionId ? " · claude " + session.claudeSessionId : ""}` +
      ` · ${new Date().toISOString()} =====\n`,
  );

  const pty = runtimeSpawnPty(claudeCmd, args, {
    cwd: session.cwd,
    env: safeEnv,
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
  });

  // Persist the session id now so it survives even if the REPL is short-lived.
  recordClaudeSession(session);

  pty.onData((data) => emitData(session, data));
  pty.onExit((exitCode) => {
    log("info", "terminal", `Claude interactive [${id}]: exited with code ${exitCode}`);
    session.alive = false;
    session.proc = null;
    session.transcriptStream?.end();
    emitExit(session, exitCode ?? 0);
    // User-driven session: no task_ai_runs finalization (see spec). Touch the
    // session row so lastUsedAt reflects the end of the conversation.
    recordClaudeSession(session);
    sessions.delete(id);
  });

  session.proc = pty;
}

// ── Public API ─────────────────────────────────────────────────

export async function isAvailable(): Promise<boolean> {
  return true;
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
  // claude-interactive options (see spawnClaudeInteractive):
  model?: string; // → claude --model <model>
  resumeSessionId?: string; // → claude --resume <id>
  continueLast?: boolean; // → claude --continue
  // Resolver agent for ai-resolve; falls back to the global aiAgent setting.
  agent?: AiAgent;
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

  // Checkout target branch before AI resolve / interactive claude
  if ((opts.type === "ai-resolve" || opts.type === "claude-interactive") && opts.branch) {
    const checkout = await checkoutBranch(cwd, opts.branch);
    if (!checkout.ok) {
      log("warn", "terminal", `Branch checkout failed for "${opts.branch}": ${checkout.error}`);
    }
  }

  // Claude interactive: live REPL running `claude` with no positional prompt
  if (opts.type === "claude-interactive") {
    spawnClaudeInteractive(session, safeEnv, opts);
    log("info", "terminal", `Session created: ${id}`, {
      type: "claude-interactive",
      backend: "bun-terminal",
    });
    return session;
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
  agent?: AiAgent,
): Promise<BatchResolveStatus> {
  if (batchState.state === "running") {
    throw new Error("A batch resolve is already running");
  }

  const resolvedAgent: AiAgent = agent ?? getConfiguredAgent();

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

  processQueueWithBranches(groups, projectId, port, effectiveConcurrency, resolvedAgent).catch(
    (err) => {
      log("error", "terminal", `Batch resolve error: ${String(err)}`);
      batchState.state = "completed";
    },
  );

  return getBatchResolveStatus();
}

async function processSingleTask(
  task: Task,
  projectId: string,
  port: number,
  agent: AiAgent,
): Promise<void> {
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

    // Create the AI resolve session. Per-task agent overrides the batch/global
    // choice; null falls back to the resolved batch agent.
    const session = await createSession({
      type: "ai-resolve",
      projectId,
      taskId: task.id,
      name: task.title,
      prompt,
      groundedArtifacts,
      agent: task.agent ?? agent,
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
  agent: AiAgent,
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
    await processQueue(tasks, projectId, port, concurrency, agent);
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
  agent: AiAgent = "claude",
): Promise<void> {
  if (concurrency <= 1) {
    // Sequential processing (original behavior)
    for (const task of tasks) {
      if (batchState.state === "cancelled") {
        log("info", "terminal", "Batch resolve cancelled");
        break;
      }
      await processSingleTask(task, projectId, port, agent);
    }
  } else {
    // Concurrent processing with a pool
    let index = 0;
    const next = async (): Promise<void> => {
      while (index < tasks.length && batchState.state !== "cancelled") {
        const task = tasks[index++];
        await processSingleTask(task, projectId, port, agent);
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
