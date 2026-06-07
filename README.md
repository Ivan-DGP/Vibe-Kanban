# Vibe Kanban

Local development dashboard for managing projects, tasks, git, terminals, and AI. Runs on localhost as a web app that complements VS Code.

![Version](https://img.shields.io/badge/version-1.3.0-blue)
![Runtime](https://img.shields.io/badge/runtime-Bun-f472b6)
![License](https://img.shields.io/badge/license-MIT-green)

## Tech Stack

| Layer           | Technology                                                                            |
| --------------- | ------------------------------------------------------------------------------------- |
| **Runtime**     | [Bun](https://bun.sh) — runs TypeScript natively, built-in SQLite, built-in WebSocket |
| **Frontend**    | React 18 + Vite + Tailwind CSS v4 + shadcn/ui                                         |
| **Backend**     | Fastify 5 + bun:sqlite                                                                |
| **Terminal**    | xterm.js over Bun WebSocket                                                           |
| **Editor**      | CodeMirror (@uiw/react-codemirror)                                                    |
| **Drag & Drop** | @dnd-kit                                                                              |
| **AI**          | Claude CLI (subprocess) + Claude API (SSE streaming)                                  |

## Quick Start

```bash
# Prerequisites: Bun v1.0+
bun install
bun run dev
```

This starts both the Vite dev server (port 5173) and the Fastify backend (port 3001). Open http://localhost:5173.

## Scripts

```bash
bun install          # Install all workspace dependencies
bun run dev          # Start client + server concurrently
bun run dev:client   # Start only the Vite dev server (:5173)
bun run dev:server   # Start only the Fastify backend (:3001, with --watch)
bun run build        # Build the client for production
bun run start        # Start the production server
bun run check        # TypeScript typecheck both client and server
```

## Architecture

Bun workspace monorepo with three packages:

```
vibe-kanban/
  client/     React SPA (Vite + Tailwind + shadcn/ui)
  server/     Fastify API (bun:sqlite, node-pty, Claude CLI)
  shared/     TypeScript types shared between client and server
  data/       SQLite database + task JSON snapshots (auto-created)
```

The Vite dev server proxies `/api`, `/ws`, and `/mcp` to the Fastify backend on port 3001.

### State Management

- **Server state** — TanStack Query v5 (staleTime 30s, refetchOnWindowFocus)
- **Client UI state** — Zustand v5 with persist middleware (localStorage)
- **Database** — SQLite via `bun:sqlite` (WAL mode, foreign keys, single connection)

## Features

### Project Management

- Auto-discover projects by scanning directories (detects package.json, .git, Cargo.toml, go.mod, etc.)
- Tech stack detection for 18+ frameworks (React, Vue, Next.js, Tailwind, Python, Go, Rust, etc.)
- Project cards with tech badges, git branch, task counts, and favorites
- Categories and external links per project

### Task Management

- Three-column Kanban board (Inbox, In Progress, Done) with drag & drop
- Priority levels (Urgent, High, Medium, Low) with color-coded indicators
- Board/List view toggle with sort options
- Task editor with Description (product view) and Prompt (technical details) tabs
- Milestones — organize tasks into milestones with active/closed status
- Virtual scrolling with load-more pagination (15 items per batch)
- Cascading timestamps: inboxAt → inProgressAt → doneAt

### Git Integration

- Real-time git status with 5-second polling (staged, unstaged, untracked files)
- Branch info with ahead/behind counts and branch switcher
- Stage/unstage individual files or all at once
- Commit, push, pull, discard changes, undo commit
- Diff viewer with syntax coloring
- Multi-repo support (sub-directory git repos show as tabs)
- GitHub account management with encrypted token storage (AES-256-CBC)

### Code Editor

- CodeMirror with syntax highlighting for 30+ file types
- Multi-tab editing with dirty-state indicators
- File explorer tree with lazy-loaded directories
- Create, rename, delete files from the explorer
- Markdown preview and image preview
- Workspace mode toggle (Tasks vs Editor) per project

### Integrated Terminal

- xterm.js terminal emulator over WebSocket
- Multiple terminal sessions (Shell, Dev Server, Claude AI, AI Resolve)
- Split view (side-by-side terminals)
- Resizable and collapsible panel

### Claude AI Integration

- **AI Resolve** — launch Claude CLI in a terminal to implement a specific task with full project context
- **AI Bulk Import** — paste unstructured text and AI organizes it into tasks
- **AI Task Manager** — send free-text instructions to manage tasks via Claude
- **Streaming Chat** — SSE streaming chat panel with markdown rendering
- Falls back from Claude CLI to Claude API automatically

### MCP Server (Model Context Protocol)

- Built-in MCP server for Claude and other AI tools
- 10 tools: list_projects, get_project, list_tasks, get_task, create_task, update_task, delete_task, get_all_tasks, git_status, git_diff
- JSON-RPC 2.0 endpoint (POST /mcp) + SSE endpoint (GET /mcp)
- OAuth client registration and token management

### Reports

- Time-filtered reports (Today, This Week, Last 30 Days, custom range)
- Summary stats: total tasks completed, total hours, average hours per task
- Grouped by project with per-project breakdowns
- Copy as Markdown

### Search

- **Command Palette** (Ctrl+K) — quick navigation to projects, pages, and tasks
- **Global Search** (Ctrl+Shift+F) — search across projects, tasks, and files
- **File Content Search** (Ctrl+Shift+G) — grep across file contents with line numbers

### Google Sheets Sync

- Bidirectional sync via Apps Script proxy
- Auto-push (2s debounce) and auto-pull (30s polling)
- Anti-loop protection (10s guard after push)

### Additional

- System logs viewer with level/category filters
- Onboarding wizard for first-time setup
- Export/import settings and data as JSON
- Dark mode support (OKLCH color system)

## Keyboard Shortcuts

| Shortcut     | Action              |
| ------------ | ------------------- |
| Ctrl+K       | Command Palette     |
| Ctrl+Shift+F | Global Search       |
| Ctrl+Shift+G | File Content Search |

## Data Storage

All data lives in `data/vibe-kanban.db` (SQLite). Task snapshots are also written to `data/tasks/{projectId}.json` after each mutation so Claude CLI can read project context from files.

GitHub tokens are encrypted at rest using AES-256-CBC with machine-specific key derivation (hostname + username + PBKDF2).

## Adding shadcn/ui Components

```bash
cd client && bunx shadcn@latest add <component>
```

## License

MIT
