# Vibe Kanban - Features

> Local development dashboard for managing projects, tasks, git, terminals, and AI.
> Runs on localhost as a web app. Complements VS Code.

**Version:** 1.3.0
**Runtime:** Bun
**Stack:** React 18 + Vite + Tailwind CSS + shadcn/ui | Fastify 5 + bun:sqlite

---

## 1. Project Management

- **Auto-discovery**: Scan directories to find projects by markers (package.json, .git, Cargo.toml, go.mod, requirements.txt, pyproject.toml)
- **Tech stack detection**: Automatically identifies frameworks and libraries (React, Vue, Svelte, Next.js, Fastify, Express, Tailwind, TypeScript, Python, Go, Rust, etc.) from package.json and config files
- **Monorepo/workspace support**: Scans workspace subdirectories for additional dependencies
- **Manual project add**: Browse and add individual project directories
- **Project cards**: Dashboard shows each project with name, tech stack badges, git branch, and task counts (inbox, in-progress, done, urgent indicators)
- **Favorites**: Star/unstar projects for quick access
- **Categories**: Organize projects by category
- **External links**: Attach external URLs to projects (e.g., Jira, Figma, docs)
- **Project settings**: Per-project configuration dialog
- **"Working On" banner**: Dashboard highlights in-progress tasks across all projects

## 2. Task Management

### Kanban Board
- **Three-column board**: Inbox (backlog + todo), In Progress, Done
- **Drag & drop**: Reorder tasks within columns and move between columns via @dnd-kit
- **Priority levels**: Urgent, High, Medium, Low with color-coded indicators
- **Sort options**: By priority, newest, oldest, or recently updated
- **Board/List toggle**: Switch between kanban board and compact list view
- **Virtual scrolling**: Load-more pagination (15 items initially, +15 on scroll)

### Task CRUD
- **Create tasks**: Inline creation with title, description, priority, and status
- **Task editor**: Full editor with description (product/user view) and prompt (technical details)
- **Task viewer**: Read-only view with formatted content
- **Bulk import**: Paste unstructured text (meeting notes, emails, bug reports) and AI organizes it into tasks
- **CSV import/export**: Copy tasks as CSV, paste CSV to diff and merge changes
- **JSON export**: Download tasks as JSON
- **Markdown export**: Export tasks as formatted Markdown (with multiple template options)
- **Task search**: Filter tasks across all projects with keyword search

### Task Timestamps (Cascading)
- `inboxAt`: Set when task enters backlog/todo
- `inProgressAt`: Set when task moves to in_progress (also sets inboxAt if missing)
- `doneAt`: Set when task completes (also sets inboxAt + inProgressAt if missing)
- Timestamps are never removed on status changes

### AI Task Features
- **AI Bulk Import**: Paste raw text, AI analyzes and structures it into tasks with titles, descriptions, priorities
- **AI Task Manager**: Send free-text instructions (e.g., "mark all auth tasks as done") and Claude CLI executes them against the project's tasks via the API
- **AI Resolve (per-task)**: Launch Claude CLI in an integrated terminal to implement a specific task, with full project context, tech stack, and task details injected as prompt
- **AI commit modes**: Per-project setting for how AI handles git after resolving tasks (commit, stage-only, or no-commit)
- **Task analysis**: AI-powered analysis button for individual tasks

## 3. Milestones

- **Create/edit/delete milestones**: Organize tasks into milestones per project
- **"General" virtual milestone**: Tasks without a milestone belong to "General" (not stored in DB)
- **Milestone selector**: Filter the kanban board by active milestone
- **Milestone status**: Active or closed
- **Cascade delete**: Deleting a milestone moves its tasks to "General"
- **Persistent selection**: Active milestone stored in localStorage per project

## 4. Git Integration

- **Git status**: Real-time display of staged, unstaged, and untracked files (5-second polling)
- **Branch info**: Current branch name, ahead/behind counts
- **Branch switching**: Browse and checkout branches via popover
- **Staging**: Stage/unstage individual files or all at once
- **Commit**: Commit form with message input
- **Push/Pull**: One-click push and pull operations
- **Discard changes**: Discard staged or unstaged changes (with confirmation)
- **Undo commit**: Soft-reset the last commit (with confirmation)
- **Git log**: Recent commit history with expandable details
- **Main branch divergence**: Shows how far the current branch has diverged from main
- **Diff viewer**: View file diffs for changed files
- **Open in editor**: Click a changed file to open it in the built-in code editor
- **Multi-repo support**: Projects with sub-directories that have their own `.git` (e.g., separate client/server repos) show tabs for each sub-repo
- **GitHub accounts**: Manage multiple GitHub accounts with encrypted token storage (AES-256-CBC, machine-specific key)
- **Per-project GitHub mapping**: Assign different GitHub accounts to different projects/sub-repos

## 5. Code Editor

- **CodeMirror-based**: Full code editor powered by @uiw/react-codemirror
- **Multi-tab**: Open multiple files in tabs with dirty-state indicators
- **Syntax highlighting**: Language-aware highlighting for 30+ file types
- **File explorer**: Tree view of project files with expand/collapse directories
- **File icons**: Extension-based file icons
- **Create/rename/delete files**: File operations from the explorer context
- **Save files**: Edit and save files directly from the browser
- **Markdown preview**: Toggle between code and rendered preview for .md/.mdx files
- **Image preview**: View images inline (PNG, JPG, GIF, SVG, WebP, etc.)
- **Workspace modes**: Toggle between "Tasks" and "Editor" mode per project (persisted)

## 6. Integrated Terminal

- **xterm.js + Bun WebSocket**: Full terminal emulator in the browser via Bun's built-in WebSocket support
- **Multi-session**: Open multiple terminal tabs simultaneously
- **Split view**: Side-by-side terminal split
- **Session types**: Shell, dev server, Claude AI, AI resolve
- **Auto-detect dev command**: Detects `bun dev`, `bun start`, or `bun serve` from package.json
- **Resizable panel**: Drag to resize terminal height (persisted)
- **Collapsible**: Show/hide terminal panel
- **AI session tracking**: Terminal tabs show AI task context and auto-detect completion

## 7. Claude AI Integration

### Claude CLI
- **Auto-detection**: Detects if `claude` CLI is installed and available
- **Prompt execution**: Runs Claude CLI as subprocess with structured prompts
- **AI Resolve**: Launches Claude in integrated terminal with task context to implement solutions
- **AI Manage**: Launches Claude to batch-manage tasks from free-text instructions
- **Context building**: Assembles project context (name, path, tech stack, git branch, tasks) for AI prompts

### Claude API
- **API key configuration**: Configure and test Claude API connection
- **Streaming chat**: Real-time SSE streaming chat panel with project context
- **Markdown rendering**: Chat responses rendered with GFM markdown, syntax highlighting
- **Task summarization**: AI-powered task summaries

### AI Backend Fallback
- Tries Claude CLI first, falls back to API if CLI unavailable
- Sound notification on AI completion (configurable)

## 8. MCP Server (Model Context Protocol)

- **Built-in MCP server**: Vibe Kanban exposes its data via MCP for Claude and other AI tools
- **Tool catalog**: list_projects, get_project, list_tasks, get_task, create_task, update_task, delete_task, get_all_tasks, git_status, git_diff
- **JSON-RPC endpoint**: POST /mcp for tool calls
- **SSE endpoint**: GET /mcp for server-sent events
- **OAuth support**: Client registration, authorization, and token management
- **Configurable**: Enable/disable MCP, toggle auth requirement
- **Token-optimized**: Slim responses (compact JSON, minimal fields) for efficient AI consumption

## 9. Google Sheets Sync

- **Bidirectional sync**: Push tasks to and pull tasks from Google Sheets via Apps Script
- **Stateless proxy**: Server proxies requests to Google Apps Script (no credentials stored on server)
- **Auto-push**: Debounced 2-second auto-push after task mutations
- **Auto-pull**: 30-second polling with bidirectional merge
- **Anti-loop protection**: 10-second guard after push prevents pull conflicts
- **URL validation**: Only allows `https://script.google.com/macros/s/...` URLs
- **Config in localStorage**: Per-project sync configuration stored client-side

## 10. Reports

- **Time-filtered reports**: Today, Yesterday, This Week, This Month, Last 7 Days, Last 30 Days, Custom range
- **Summary statistics**: Total tasks completed, total hours, average hours per task
- **Hour estimation**: Calculates from inProgressAt-to-doneAt timestamps, falls back to priority-based estimates
- **Grouped by project**: Tasks organized under project headers with per-project totals
- **Copy as Markdown**: One-click copy of report as formatted Markdown table

## 11. Search

- **Global Search** (Ctrl+Shift+F): Search across projects, tasks, and files with tab filters (All, Projects, Tasks, Files)
- **Command Palette** (Ctrl+K): Quick navigation to projects, tasks, pages, and settings
- **File Content Search** (Ctrl+Shift+G): Grep-like search across file contents with line numbers, case sensitivity toggle, and click-to-open
- **Task search**: Filter tasks by keyword in the Tasks page and kanban boards

## 12. System Logs

- **Categorized logging**: Server, Git, Claude, Sync, Terminal, MCP, Tasks, Files
- **Log levels**: Info, Warn, Error with color-coded badges
- **Filterable**: Filter by level and category
- **Grouped by date**: Logs organized chronologically
- **Statistics**: Total count and error/warning counts
- **Clear logs**: Bulk delete logs
- **Expandable details**: Click to expand full log entry details

## 13. Settings

- **Project scanning**: Scan directories and bulk-add discovered projects
- **Manual project add**: Browse for individual project directories
- **Export/Import**: Full backup/restore of settings and tasks as JSON
- **Sound toggle**: Enable/disable AI completion sounds
- **Claude AI config**: API key management and CLI status
- **MCP config**: Enable/disable MCP server, manage OAuth clients
- **Google Sheets sync**: Configure sync URLs per project

## 14. Onboarding

- **Welcome wizard**: Multi-step onboarding for first-time users
- **Directory scanning**: Guided folder selection to discover and import projects
- **Feature overview**: Introduction to key features (tasks, git, terminals, sync, keyboard shortcuts)
- **Dismissable**: Onboarding state persisted in localStorage

## 15. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+K | Command Palette |
| Ctrl+Shift+F | Global Search |
| Ctrl+Shift+G | File Content Search |
| 1-9 | Switch tabs |
| Navigation | Sidebar quick-access to Dashboard, Tasks, Settings, Reports, Logs, Help |

## 16. Data & Storage

- **SQLite database**: All data stored in `data/vibe-kanban.db` via bun:sqlite (native, zero-dependency)
- **Auto-migration**: Startup migration imports legacy JSON files into SQLite
- **JSON snapshots**: Task data also written to `data/tasks/{projectId}.json` after each mutation (for Claude CLI file-based context)
- **Centralized data path**: All file I/O through a single data directory module
- **GitHub token encryption**: AES-256-CBC encryption with machine-specific key derivation
