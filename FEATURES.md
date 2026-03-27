# Vibe Kanban - Feature Reference

A local development dashboard for managing projects, tasks, git, terminals, and AI. Runs on localhost as a web app that complements VS Code.

---

## Project Management

- **Auto-discovery** scanning directories for projects by markers (package.json, .git, Cargo.toml, go.mod, requirements.txt, pyproject.toml, pom.xml, build.gradle)
- **Tech stack detection** from package.json dependencies and config files (React, Vue, Next.js, Svelte, Fastify, Express, Tailwind, TypeScript, Python, Go, Rust, etc.)
- **Categories** for organizing projects into groups
- **Favorites** for quick access with starred projects shown first
- **External links** per project (Jira, Figma, docs, etc.)
- **Per-project settings**: AI commit mode (commit / stage / none), Notion database linking, GitHub account mapping, Google Sheets sync URL
- **Workspace mode toggle**: switch between Tasks view and Editor view per project
- **"Working On" banner** on the dashboard showing in-progress tasks across all projects
- **Project cards** display name, tech stack badges, current git branch with ahead/behind counts, and task counts

---

## Task Management

### Core CRUD
- **Inline quick-create** in kanban columns (title only)
- **Full editor dialog** with title, description (user-facing), prompt (technical AI details), status, priority, branch, and milestone
- **Task cloning** with copy-suffix
- **Bulk import** from unstructured text (AI-powered parsing)
- **Auto-assigned task numbers** per project
- **Auto-assigned sort order** per status column

### Kanban Board
- **Three columns**: Inbox (backlog + todo), In Progress, Done
- **Drag-and-drop** reordering within and between columns (@dnd-kit)
- **Sorting**: by priority, newest, oldest, or recently updated
- **Search** across title and description with live filtering
- **Milestone filtering** with active milestone selector persisted per project
- **Virtual scrolling** with load-more pagination (15 items per page)
- **List view toggle** for compact single-line display

### Milestones
- Create, edit, and delete milestones per project
- Active/closed status toggle
- Virtual "General" milestone for unassigned tasks
- Deleting a milestone moves its tasks to General

### Timestamp Cascade
Timestamps cascade forward and are never removed:
- `inboxAt` set on backlog/todo entry
- `inProgressAt` set on in_progress (also sets inboxAt if missing)
- `doneAt` set on done (also sets inboxAt + inProgressAt if missing)

### Branch Sessions
- Assign a **git branch** to tasks so AI resolve runs on the correct branch
- **BranchSelector** component: filter existing branches or type to create new ones
- Branch badge displayed on task cards and viewer dialog
- **Batch resolve groups tasks by branch** and processes branch-by-branch
- **Override branch** option in batch dialog to run all tasks on a single branch
- Auto-checkout before AI resolve (tries existing branch, falls back to `git checkout -b`)

### Export & Import
- **CSV export** with headers: title, status, priority, description, milestoneId, createdAt, doneAt
- **JSON export** with full task objects
- **Markdown export** with tasks grouped by status and checkbox formatting
- **AI bulk import** from unstructured text (meeting notes, emails, bug reports)

---

## AI Features (Claude Integration)

### AI Resolve (Single Task)
- Launches Claude CLI in an integrated terminal with full project context
- Context includes: project name, path, tech stack, git branch, file tree, architecture rules, dependencies, recent commits, other active tasks
- Per-project AI commit mode (auto-commit, stage-only, or no-commit)
- Claude auto-updates task status to "done" when finished via API callback

### AI Resolve (Batch)
- Resolve multiple tasks concurrently with configurable concurrency (1-10)
- Branch-aware: tasks grouped by branch and processed sequentially between groups
- Optional override branch for the entire batch
- Real-time progress polling with cancel support

### AI Analyze
- Per-task analysis generating complexity estimate, suggested approach, and potential risks
- Accessible from task card hover menu or viewer dialog

### AI Chat
- Streaming SSE chat with Claude, project context auto-injected
- Markdown rendering with GitHub Flavored Markdown support

### AI Task Manager
- Free-text instructions (e.g., "mark all auth tasks done", "create 3 tasks for login")
- Claude CLI parses and executes instructions against the project's task API

### AI Writing Tools
- **Gather Context**: generates technical implementation prompt from task title and description
- **AI Improve Writing**: refines title, description, or prompt for clarity and structure

### Backend Fallback
- Tries Claude CLI first (`which claude`), falls back to Claude API if unavailable
- API key configurable in settings, CLI availability cached for 60s

---

## Git Integration

### Status & Information
- Real-time git status with 5-second polling
- Branch name, upstream, ahead/behind counts
- Staged, unstaged, and untracked file lists with status codes (M, A, D, R, C)
- Divergence from main/master branch

### File Operations
- Stage/unstage individual files or all at once
- Discard changes with confirmation

### Commits
- Commit with message input
- Undo last commit (soft reset)
- Commit history (30 most recent) with hash, author, date, message

### Branch Management
- List local and remote branches
- Checkout existing branch
- Create new branch (with optional base branch)
- Branch switcher popover in project header

### Diff Viewer
- View diffs for changed files
- Click to open file in code editor

### Remote Operations
- Push and pull with error feedback

### Sub-Repository Support
- Detect sub-directories with their own `.git`
- Separate git panel tabs per sub-repo with independent operations

### GitHub Accounts
- Store multiple GitHub accounts with **AES-256-CBC encrypted tokens** (machine-specific key derivation)
- Per-project (and per-sub-path) GitHub account mapping

---

## Terminal

- **Multi-session** with tabs: shell, dev server, Claude AI, AI resolve
- **xterm.js** terminal emulator with WebSocket streaming
- **Real PTY** via Bun's built-in terminal API (no node-pty dependency)
- **Scrollback buffer** (100KB) for reconnection support
- **Auto-detect dev command** from package.json (bun/npm/yarn run dev/start/serve)
- **Resizable** panel height, collapsible/toggleable visibility
- **Split view** for side-by-side terminals
- Configurable shell (bash, zsh, PowerShell, cmd)

---

## Code Editor

- **CodeMirror** with syntax highlighting for TypeScript/TSX, JavaScript/JSX, HTML, CSS, JSON, Markdown, Python
- **Tab management** with dirty state indicators
- **Ctrl+S** to save files
- **File explorer** with tree view, create/rename/delete, and search
- **Markdown preview** toggle for .md/.mdx files
- **Image preview** for PNG, JPG, GIF, SVG, WebP
- **Protected files** (.git/hooks, .env, .git/config, .git/objects) cannot be modified
- File size limit: 5MB

---

## Notion Integration

- **Read-only** reference tool: pulls Notion data for display, no writes back
- Configure Notion API key (internal integration token) in settings
- Link one Notion database per project
- **Notion panel** in project view lists pages from linked database
- Click a page to view full content rendered as markdown
- Converts Notion blocks (headings, paragraphs, lists, code, quotes, callouts, images) to markdown
- Simplifies database properties (multi-select, status, dates, checkboxes) to readable values

---

## Google Sheets Sync

- **Bidirectional** sync via Google Apps Script proxy
- Push tasks to Google Sheets on mutation (debounced 2s auto-push)
- Pull tasks from Google Sheets (30s polling)
- Anti-loop guard (10s after push)
- Per-project sync URL configuration
- URL validation: must match `https://script.google.com/macros/s/...`

---

## MCP Server (Model Context Protocol)

Exposes project and task data to AI tools via JSON-RPC 2.0:

| Tool | Description |
|------|-------------|
| `list_projects` | List all projects with names, paths, tech stacks |
| `get_project` | Get specific project details |
| `list_tasks` | List tasks for a project, optionally filtered by status |
| `get_task` | Get single task details |
| `create_task` | Create a new task |
| `update_task` | Update task fields |
| `delete_task` | Delete a task |
| `get_all_tasks` | All tasks across all projects (up to 100) |
| `git_status` | Git status for a project |
| `git_diff` | Git diff for a project |

- SSE endpoint (`GET /mcp`) for streaming
- JSON-RPC endpoint (`POST /mcp`)
- Optional OAuth authentication with client registration
- Toggleable in settings

---

## Reports

- **Period selection**: today, yesterday, this week, this month, last 7 days, last 30 days, custom date range
- **Summary stats**: total tasks completed, total hours, average hours per task
- **Project grouping** with per-project subtotals
- **Time calculation** from `inProgressAt` to `doneAt` timestamps, fallback estimation by priority
- **Copy as Markdown** for pasting into docs

---

## Personal Todos

- Separate todo list from project tasks
- Optional linking to project tasks
- Drag-and-drop reordering
- Mark complete / clear all completed
- Accessible from sidebar (keyboard shortcut: `3`)

---

## System Logs

- Categories: server, git, claude, sync, terminal, mcp, tasks, files
- Levels: info, warn, error (color-coded badges)
- Paginated viewer grouped by date
- Filter by level and category
- Expandable entries with structured detail metadata
- Clear all logs

---

## Search & Navigation

### Command Palette (Ctrl+K)
- Quick navigation to pages and projects
- Fuzzy search by name

### Global Search (Ctrl+Shift+F)
- Search across projects, tasks, and files
- Tab filters: All, Projects, Tasks, Files

### File Content Search (Ctrl+Shift+G)
- Grep-like search across file contents
- Case-sensitivity toggle, regex support
- Click to open file in editor

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command palette |
| `Ctrl+Shift+F` | Global search |
| `Ctrl+Shift+G` | File content search |
| `1`-`9` | Quick navigate sidebar items |
| `Ctrl+S` | Save file in editor |
| `Escape` | Close dialogs/overlays |

---

## Settings

- **Claude AI**: API key, connection test, CLI availability status
- **GitHub**: Account management with encrypted tokens, per-project mappings
- **Notion**: API key, database linking status
- **Google Sheets**: Per-project sync URL
- **General**: Sound notifications toggle, terminal shell selection (bash/zsh/PowerShell/cmd)
- **MCP**: Enable/disable, auth requirement toggle, endpoint URL display
- **Data**: Full backup export (JSON), restore/import with validation

---

## Onboarding

- Multi-step welcome wizard for first-time users
- Directory selection for project scanning
- Feature overview
- Skip option, completion state persisted in localStorage

---

## UI & Layout

- **Dark theme** by default with Tailwind dark mode
- **Responsive layout** with collapsible sidebar
- **Sidebar navigation**: Dashboard, Tasks, Todos, Reports, Logs, Settings, Help + project list with favorites first
- **Custom dialogs**: confirmation and alert components (no native browser dialogs)
- **Toast notifications** via sonner (success, error, info with auto-dismiss)
- **Skeleton loaders** during data fetching
- **Sound notifications** on AI task completion (toggleable)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun (native TypeScript, built-in SQLite, built-in WebSocket) |
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| Backend | Fastify 5 + bun:sqlite |
| Terminal | xterm.js over Bun WebSocket |
| Editor | CodeMirror (@uiw/react-codemirror) |
| Drag & Drop | @dnd-kit |
| State | TanStack Query (server) + Zustand with persist (client UI) |
| Routing | React Router v6 with lazy-loaded routes |
| AI | Claude CLI (subprocess) + Claude API (SSE streaming) |

---

## Data Architecture

- **SQLite** as single source of truth (`data/vibe-kanban.db`) with WAL mode
- **JSON snapshots** written after each task mutation for Claude CLI file context
- **In-memory terminal sessions** (not persisted across restarts)
- **Migration system** with versioned schema upgrades
- **Bun workspace monorepo**: `client/`, `server/`, `shared/`
