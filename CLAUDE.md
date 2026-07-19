# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Response Style

Write terse. Drop articles, filler words, pleasantries, hedging. Use fragments. Keep all technical accuracy and substance. No trailing summaries of what you just did — the diff speaks for itself. Code blocks, URLs, and commands stay exact.

## Project Overview

Vibe Kanban is a local development dashboard for managing projects, tasks, git, terminals, and AI. It runs on localhost as a web app that complements VS Code.

## Tech Stack

- **Runtime:** Bun (runs TypeScript natively, built-in SQLite, built-in WebSocket)
- **Frontend:** React 18 + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Fastify 5 + bun:sqlite
- **Terminal:** xterm.js over Bun WebSocket
- **Editor:** CodeMirror (@uiw/react-codemirror)
- **Drag & Drop:** @dnd-kit
- **AI:** Claude CLI (subprocess) + Claude API (SSE streaming)

## Development Commands

```bash
bun install          # Install all workspace dependencies
bun run dev          # Start both client (Vite :5173) and server (Fastify :3001) concurrently
bun run dev:client   # Start only the Vite dev server
bun run dev:server   # Start only the Fastify backend (with --watch)
bun run build        # Build the client for production
bun run start        # Start the production server
bun run check        # TypeScript typecheck both client and server
```

Adding shadcn/ui components: `cd client && bunx shadcn@latest add <component>`

## Skills (prefer these over working ad-hoc)

Reach for a skill before doing the work by hand. A `UserPromptSubmit` hook also echoes routing on every prompt.

**Project commands** (local, embed exact invocations — use these for this repo):

- `/check` — typecheck + lint + tests (`bun run check`, `bun run lint`, `bun run --cwd server test`)
- `/test` — server unit tests only
- `/decision-audit` — review an AI change by its *decisions*, not its diff; the merge gate after `/check` is green (pairs with `/code-review`)

**Workflow** (global skills):

- `/spec` — new feature/spec before building
- `/mission` — multi-feature project; phased orchestration in `.missions/` (fits the multi-feature work on this branch)
- `/scaffold-tests` — new or untested module
- `/code-review` — deep diff review for bugs + cleanup; `--fix` applies, `--comment` posts to PR (canonical reviewer — supersedes a plain `git diff` read)
- `/simplify` — apply reuse/simplification/efficiency cleanups (quality only, no bug hunt)
- `/verify` or `/run` — confirm a change works by launching the app, not just tests
- `/sherlock` — codebase health pass
- `/readiness` — AI-readiness audit of project setup
- `/deep-research` — multi-source, fact-checked research report

**Security** (run on auth, input parsing, secrets, dep changes, or pre-release):

- `/vuln-scan` → `/triage` → fix via `/patch`
- `/threat-model` — bootstrap `THREAT_MODEL.md` if missing

## Architecture

**Bun workspace monorepo** with three packages: `client/` (React SPA), `server/` (Fastify API), `shared/` (TypeScript types). The Vite dev server proxies `/api`, `/ws`, `/mcp` to the Fastify backend on port 3001.

- **Frontend state:** TanStack Query for server state, Zustand (with persist middleware) for client UI state
- **Routing:** React Router v6 with lazy-loaded route components
- **Backend:** Fastify plugins per route group, one SQLite connection via `server/src/db/index.ts`

### Key Architectural Patterns

- **SQLite as single source of truth:** All persistent data lives in `data/vibe-kanban.db` with auto-migration from legacy JSON on startup.
- **JSON snapshots:** After each task mutation, task data is also written to `data/tasks/{projectId}.json` so Claude CLI can read project context from files.
- **MCP server:** The backend exposes a Model Context Protocol server (JSON-RPC on POST `/mcp`, SSE on GET `/mcp`) with tools like `list_projects`, `list_tasks`, `git_status`, `git_diff`, etc.
- **Terminal multiplexing:** Bun spawns shell processes; xterm.js renders them in the browser via Bun's built-in WebSocket. Supports multiple sessions (shell, dev server, Claude AI, AI resolve).
- **AI fallback chain:** Claude CLI is preferred; falls back to Claude API if CLI is unavailable.
- **GitHub token encryption:** AES-256-CBC with machine-specific key derivation.
- **Google Sheets sync:** Bidirectional via Apps Script proxy with debounced auto-push (2s) and polling auto-pull (30s) with anti-loop guard (10s).

### Task Timestamp Cascade

When tasks change status, timestamps cascade forward (never removed):

- `inboxAt` set on backlog/todo entry
- `inProgressAt` set on in_progress (also sets `inboxAt` if missing)
- `doneAt` set on done (also sets `inboxAt` + `inProgressAt` if missing)

### Milestones

Milestones are real DB rows (`milestones` table, stable `id`); tasks reference one via `milestoneId` (FK, `ON DELETE SET NULL`). Tasks without a milestone belong to a virtual "General" bucket (`milestoneId IS NULL`) — only the General bucket is virtual, not milestones themselves. Deleting a milestone moves its tasks to General. Active milestone _selection_ is stored in localStorage per project.

### Data Flow

- All file I/O goes through a centralized data directory module.
- Git status uses 5-second polling.
- Kanban board uses virtual scrolling (15 items initially, +15 on load-more).
- Google Sheets sync URLs are validated to match `https://script.google.com/macros/s/...`.
