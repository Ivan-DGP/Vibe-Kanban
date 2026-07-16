// ── tmux backend for persistent terminals ─────────────────────
//
// Interactive shell terminals are run inside detached tmux sessions instead of
// as direct children of the API server. The tmux server double-forks and is
// reparented to init, so it OUTLIVES a restart of this process: the shell and
// anything running in it keep going. After a restart the API server re-attaches
// (`attach-session`) and the browser reconnects to the same session id.
//
// A dedicated socket (`-L vibe-kanban`) namespaces our sessions away from any
// personal tmux the user runs. Sessions are named with the terminal session id
// (`term-<uuid>`), so the id is the only key needed to find or kill one.

import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnProcessSync } from "../lib/runtime";

const SOCKET = "vibe-kanban";
export const SESSION_PREFIX = "term-";

// Server-level config applied when the tmux server first starts (via `-f`):
// hide the status bar (this is an embedded terminal, not a multiplexer UI) and
// give the shell a sane TERM + scrollback.
const CONF_PATH = join(tmpdir(), "vibe-kanban-tmux.conf");
const CONF_BODY =
  'set -g status off\nset -g default-terminal "xterm-256color"\nset -g history-limit 10000\n';

function ensureConf(): void {
  try {
    if (!existsSync(CONF_PATH)) writeFileSync(CONF_PATH, CONF_BODY);
  } catch {
    /* best-effort — tmux still works without the conf, just with a status bar */
  }
}

/** Base argv shared by every invocation: socket + config file. */
function base(): string[] {
  ensureConf();
  return ["-L", SOCKET, "-f", CONF_PATH];
}

let _available: boolean | null = null;

/** True when a usable `tmux` binary is on PATH (cached). Unix only. */
export function isTmuxAvailable(env: Record<string, string>): boolean {
  if (_available !== null) return _available;
  if (process.platform === "win32") return (_available = false);
  try {
    _available = spawnProcessSync(["tmux", "-V"], { env }).exitCode === 0;
  } catch {
    _available = false;
  }
  return _available;
}

/** @internal reset the availability cache — tests only. */
export function _resetAvailability(): void {
  _available = null;
}

function run(args: string[], env: Record<string, string>): { stdout: string; exitCode: number } {
  return spawnProcessSync(["tmux", ...base(), ...args], { env });
}

/**
 * The env for a tmux CLIENT (the attach PTY). tmux refuses to attach without a
 * usable TERM, which the sandboxed server env often lacks — default it so attach
 * always succeeds. The shell inside gets TERM from the conf's default-terminal.
 */
export function clientEnv(env: Record<string, string>): Record<string, string> {
  return env.TERM ? env : { ...env, TERM: "xterm-256color" };
}

/**
 * Create the tmux session if it doesn't already exist, DETACHED. Detached
 * creation needs no controlling terminal (unlike attach), so it's reliable from
 * a non-tty server process. `-A -d` is idempotent: attach-or-create, but stay
 * detached. Returns true when the session exists afterwards.
 */
export function tmuxEnsureSession(
  id: string,
  shell: string,
  shellArgs: string[],
  env: Record<string, string>,
  cols: number,
  rows: number,
): boolean {
  const envFlags: string[] = [];
  for (const [k, v] of Object.entries(env)) envFlags.push("-e", `${k}=${v}`);
  run(
    [
      "new-session",
      "-A",
      "-d",
      "-s",
      id,
      "-x",
      String(cols),
      "-y",
      String(rows),
      ...envFlags,
      shell,
      ...shellArgs,
    ],
    env,
  );
  return tmuxHasSession(id, env);
}

/** argv (for spawnPty) that attaches this PTY to an existing session. */
export function tmuxAttachArgs(id: string): string[] {
  return [...base(), "attach-session", "-t", id];
}

export function tmuxHasSession(id: string, env: Record<string, string>): boolean {
  return run(["has-session", "-t", id], env).exitCode === 0;
}

export function tmuxKillSession(id: string, env: Record<string, string>): void {
  try {
    run(["kill-session", "-t", id], env);
  } catch {
    /* already gone */
  }
}

/** Names of all live sessions on our socket ([] when no server is running). */
export function tmuxListSessions(env: Record<string, string>): string[] {
  const res = run(["list-sessions", "-F", "#{session_name}"], env);
  if (res.exitCode !== 0) return []; // no server / no sessions
  return res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
