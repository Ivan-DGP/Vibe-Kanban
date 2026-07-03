# Spec: Interactive Claude Terminal in Vibe Kanban

**Status:** proposed (not started)
**Requested by:** Ivan — 2026-07-03

## Goal

A first-class **interactive Claude session** inside the VK web UI — a live REPL you
type into (like running `claude` yourself in a terminal), not a one-shot prompt and
not the Q&A chat panel. You can:

- start a **persistent** interactive `claude` session running in the project's cwd,
- pick the **model** (sonnet / opus / haiku …) at launch,
- **choose the session**: new, continue last (`-c`), or resume a specific id
  (`--resume <id>`), and switch between sessions,
- keep the session alive + reconnect to it (scrollback restored), same as a terminal.

## Non-goals

- Not the existing **AI Resolve** (spawns `claude … <prompt>` and runs autonomously
  to completion on a branch).
- Not the **AIChatPanel** Q&A (`claude -p`, no tools, 30s turns).
- Not multi-user collaboration on one session.

## Current state (what to build on)

- `server/src/services/terminalService.ts` already has full PTY infra: `spawnPty`
  over Bun WS + xterm.js, a session store with **scrollback + reconnect**, keystroke
  forwarding (the plain `shell` terminal already pipes stdin → PTY), and
  `spawnAiResolve` which spawns `claude --session-id <uuid> --dangerously-skip-permissions <prompt>`.
- `CreateSessionOptions` / `PtySession` / `TerminalSessionType` (shared type) enumerate
  session kinds; the WS route (`routes/terminalWs.ts`) already streams any PTY session.
- Client: `TerminalPanel.tsx` / `TerminalTabs.tsx` render sessions; `useTerminal.ts`
  creates them. AI Resolve is launched from `AIResolveButton.tsx`.
- CLI confirmed to support `--session-id <uuid>`, `-r/--resume [id]`, `-c/--continue`,
  `--model <name>` (verified on the VPS).

## Design

### New session type: `claude-interactive`
Add to `TerminalSessionType` (shared) + a `spawnClaudeInteractive()` in terminalService
that spawns **interactive `claude` with NO positional prompt** so it's a live REPL:

```
claude \
  [--model <model>] \
  [--resume <sessionId> | --continue] \
  --dangerously-skip-permissions
```
- cwd = project path (or a checked-out branch, like AI Resolve).
- Reuse the existing PTY + WS + scrollback path (no new transport).
- Reuse the existing stdin→PTY forwarding so the user types directly into `claude`.
- Pin `--session-id <uuid>` on **new** sessions (so we always know the id for later
  resume/switch), OR capture it if the CLI can report it.

### Options (extend `CreateSessionOptions`)
- `model?: string` → `--model`
- `resumeSessionId?: string` → `--resume <id>`
- `continueLast?: boolean` → `-c`
Persist `model` + the claude session id on the session (and ideally a small
`claude_sessions` table or reuse `task_ai_runs`) so a picker can list/switch them.

### Frontend
- A **launcher** (button near AI Resolve / a "New Claude Terminal" action in the
  terminal panel) opening a small dialog:
  - **Model** dropdown (sonnet/opus/haiku/default),
  - **Session**: New · Continue last · Resume id (dropdown of known ids, or paste),
  - optional target branch.
- On confirm → `createSession({ type: "claude-interactive", projectId, taskId?, model, resumeSessionId?/continueLast? })`.
- Render as a terminal tab (reuse `TerminalTabs`); show the active model + session id
  in the tab header; a "switch session" control re-spawns with `--resume`.

### Session enumeration ("change the session")
- MVP: New / Continue-last (`-c`) / Resume-by-id (paste or pick from ids VK has
  spawned, tracked in DB).
- Later: enumerate real Claude sessions from `~/.claude` and list them with
  titles/timestamps.

## Edge cases / notes
- **Auth:** relies on `claude` logged in as the service user (same as everything).
- **cwd / branch:** mirror AI Resolve's `checkoutBranch` handling when a branch is given.
- **Reconnect/scrollback:** already handled by the PTY session store — nothing new.
- **Lifecycle:** killing the tab kills the PTY; no `task_ai_runs` finalization needed
  unless we want to record interactive sessions.
- **Auto-resume interplay:** interactive sessions are user-driven; the usage-limit
  auto-resume (headless/AI-Resolve) does NOT apply — if the limit hits mid-REPL,
  `claude` shows it in the terminal and the user resumes manually. (Could later add a
  "resume when limit clears" affordance.)

## Related gap: persist session output (transcripts)

Today VK streams PTY output to the browser and keeps only an **in-memory**
scrollback (`MAX_SCROLLBACK_CHARS`) that is **dropped when the session exits**
(`sessions.delete(id)`), so once an AI Resolve / terminal session ends its output is
lost in VK. (The underlying `claude` conversation is still saved by the CLI under
`~/.claude/projects/…` and recoverable via `claude --resume`, but VK shows nothing.)

Fold into this work: **persist the transcript** so it survives the session —
options: append the PTY stream to a per-run file under `VK_DATA_DIR/transcripts/<runId>.log`
(or a `task_ai_runs.transcript`/blob), and surface a "view output" link on the run in
the AI Runs panel. Applies to AI Resolve + the new interactive terminal.

## Acceptance criteria
1. From a project, launch a **Claude Terminal**; a live `claude` REPL runs in the
   project cwd; typing works; output streams; reconnect restores scrollback.
2. Model is selectable at launch and reflected in the running session.
3. Can start **new**, **continue last**, or **resume a specific session id**, and
   switch the active session.
4. Multiple concurrent Claude terminals per project, independent sessions.
5. Works over the existing Tailscale-only web UI with no new transport.

## Rough implementation order
1. shared `TerminalSessionType` + `CreateSessionOptions` fields.
2. `spawnClaudeInteractive()` in terminalService (+ persist model/sessionId).
3. WS/route: confirm the generic terminal path handles the new type (likely no change).
4. Frontend launcher dialog (model + session) + tab rendering + switch control.
5. (Later) real session enumeration from `~/.claude`.
