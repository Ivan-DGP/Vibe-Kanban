# Vibe Kanban - Feature Reference

Local development dashboard for managing projects, tasks, git, terminals, AI, per-project knowledge, and cross-project intelligence. Runs on localhost as a web app that complements VS Code.

---

## Project Management

- **Auto-discovery** by scanning directories for project markers (`package.json`, `.git`, `Cargo.toml`, `go.mod`, `requirements.txt`, `pyproject.toml`, `pom.xml`, `build.gradle`)
- **Tech stack detection** from package.json dependencies and config files (React, Vue, Next.js, Svelte, Fastify, Express, Tailwind, TypeScript, Python, Go, Rust, etc.)
- **Categories** for organizing projects into groups
- **Favorites** for quick access — starred projects shown first in sidebar
- **External links** per project (Jira, Figma, docs, etc.)
- **Per-project settings**:
  - AI commit mode (`commit` / `stage` / `none`)
  - Free-text `aiInstructions` injected into AI prompts
  - File-tree depth (`treeDepth`) for AI context
  - Notion database linking
  - GitHub account mapping (per sub-path)
  - Google Sheets sync URL
  - Multi-session orchestration: `autoSpawnEnabled`, `qaAgentPath`, `qaAgentPython`
- **Workspace mode toggle** per project: Tasks / Editor / **Knowledge**
- **"Working On" banner** showing in-progress tasks across all projects
- **Project cards** display name, tech stack badges, current git branch with ahead/behind counts, and task counts
- **Project AI stats**: total runs, success rate, average duration, common failures, profile breakdown

---

## Task Management

### Core CRUD

- **Inline quick-create** in kanban columns (title only)
- **Full editor dialog** with title, description (user-facing), prompt (technical AI details), status, priority, branch, milestone, and prompt profile
- **Six statuses**: `backlog`, `todo`, `in_progress`, `done`, `approved`, `archived`
- **Prompt profiles**: `auto`, `quick-fix`, `feature`, `refactor`, `bug-fix`, `docs` — drives AI prompt builder selection
- **Task cloning** with copy-suffix
- **Bulk import** from unstructured text (AI-powered parsing)
- **Notion → Tasks import** — pull Notion database rows into project tasks
- **Auto-assigned task numbers** per project
- **Auto-assigned sort order** per status column
- **Cross-project Tasks page** with status filter and live search across all projects
- **Paste screenshots** into task dialogs as artifacts

### Kanban Board

- **Four columns**: Inbox (backlog + todo), In Progress, Done, **Approved**
- **Bulk archive** all approved tasks to clean the board
- **Drag-and-drop** reordering within and between columns (@dnd-kit)
- **Sorting**: by priority, newest, oldest, or recently updated
- **Search** across title and description with live filtering
- **Milestone filtering** with active milestone selector persisted per project
- **Virtual scrolling** with load-more pagination (15 items per page)
- **List view toggle** for compact single-line display
- **CI status badge** per task (GitHub Actions check result for task's branch)

### Milestones

- Create, edit, and delete milestones per project
- Active/closed status toggle
- Per-milestone AI instructions
- Virtual "General" milestone for unassigned tasks
- Deleting a milestone moves its tasks to General

### Timestamp Cascade

Timestamps cascade forward and are never removed:

- `inboxAt` set on backlog/todo entry
- `inProgressAt` set on in_progress (also sets inboxAt if missing)
- `doneAt` set on done (cascades inboxAt + inProgressAt)
- `approvedAt` set on approved (cascades earlier stamps)
- `archivedAt` set on archived

### Branch Sessions

- Assign a **git branch** to tasks so AI resolve runs on the correct branch
- **BranchSelector**: filter existing branches or type to create new ones
- Branch badge displayed on task cards and viewer dialog
- **Batch resolve groups tasks by branch** and processes branch-by-branch
- **Override branch** option in batch dialog to run all tasks on a single branch
- Auto-checkout before AI resolve (tries existing branch, falls back to `git checkout -b`)

### Export & Import

- **CSV export** with headers: title, status, priority, description, milestoneId, createdAt, doneAt
- **JSON export** with full task objects
- **Markdown export** grouped by status with checkbox formatting
- **AI bulk import** from unstructured text (meeting notes, emails, bug reports)
- **Notion database → tasks** import flow

---

## AI Features (Claude Integration)

### AI Resolve (Single Task)

- Launches Claude CLI in an integrated terminal with full project context
- Context includes: project name, path, tech stack, git branch, file tree, architecture rules, dependencies, recent commits, other active tasks, per-project AI instructions, per-milestone instructions
- Profile-aware prompt builder: `quick-fix`, `feature`, `refactor`, `bug-fix`, `docs` each get tailored prompts
- Per-project AI commit mode (auto-commit, stage-only, or no-commit)
- Claude auto-updates task status to "done" when finished via API callback
- **SSE error events** surface silent Claude CLI failures back to the UI
- **AI preflight** endpoint returns detected profile, complexity scope, and warnings before launch

### AI Resolve (Batch)

- Resolve multiple tasks concurrently with configurable concurrency (1–10)
- Branch-aware: tasks grouped by branch and processed sequentially between groups
- Optional override branch for the entire batch
- Real-time progress polling with cancel support
- Active-task tracking returns currently running task IDs and titles

### Multi-Session Orchestration

- **Auto-spawn** headless Claude sessions when tasks of a registered `metadata.type` are created (gated by per-project `autoSpawnEnabled`)
- Built-in spawn configs:
  - `qa-test` — runs a QA agent against the task, files a `dev-fix` task if issues found
  - `dev-fix` — implements fixes filed by the QA pass, then re-queues `qa-test`
  - `bench-codebase` — drives benchmark fixtures end-to-end
- Per-project `qaAgentPath` + `qaAgentPython` configure the external QA agent invocation
- Headless Claude spawner with isolated MCP config per session
- Spawn registry is the extension point — register new types in `registerSpawnConfigs.ts`

### Task AI Runs

- Every AI invocation recorded in `task_ai_runs` with: session ID, profile, complexity, exit code, success, files changed, duration, summary
- **Anonymized capture** for analytics — strips paths and identifiers
- Per-project rollups: total runs, success rate, average duration, profile breakdown, most common failure reasons

### AI Analyze

- Per-task analysis generating complexity estimate, suggested approach, and potential risks
- Accessible from task card hover menu or viewer dialog

### AI Chat

- Streaming SSE chat with Claude, project context auto-injected
- Markdown rendering with GitHub Flavored Markdown

### AI Task Manager

- Free-text instructions (e.g., "mark all auth tasks done", "create 3 tasks for login")
- Claude CLI parses and executes instructions against the project's task API

### AI Writing Tools

- **Gather Context**: generates technical implementation prompt from task title and description
- **AI Improve Writing**: refines title, description, or prompt for clarity and structure

### Backend Fallback

- Tries Claude CLI first (`which claude`), falls back to Claude API if unavailable
- API key configurable in settings; CLI availability cached for 60s

---

## Knowledge Base (per-project)

Every project gets a dedicated knowledge layer, stored in Vibe-Kanban's data dir (not in the project's repo). Accessed via the **Knowledge** workspace mode toggle.

### Artifacts

- Per-project file store: documents, diagrams, images, research notes, specs, other
- Six artifact types with distinct icons and color tags
- **Create** markdown docs inline with CodeMirror editor
- **Upload** files (drag-and-drop, file picker, or Ctrl+V paste)
- **Paste screenshots** directly from clipboard
- Filter by type, search by filename/description, tag system
- Image preview, markdown preview, raw viewer for other types
- Stored in `data/artifacts/{projectId}/` with metadata in SQLite

### Roadmap

- Horizontal timeline with status lanes (planned / in_progress / completed / blocked)
- Items can link to milestones
- Start/end dates, color coding, dependency arrows between items
- Drag to reorder, click to edit

### Knowledge Graph

- Force-directed graph (custom physics simulation, no external lib)
- Six node types with distinct colors: concept (blue), system (purple), person (green), decision (amber), technology (cyan), risk (red)
- Six edge types: related, depends_on, implements, extends, conflicts, owned_by
- Click to edit, drag to reposition, right-click for context menu
- **Draft from dependencies:** analyzes the project's import structure, groups files into subsystem communities, and creates suggested `system` nodes + `depends_on` edges that you confirm through the existing suggestions flow. Idempotent — re-running replaces prior dep-graph suggestions. Subsystem labels come from the configured AI agent pinned to the Opus model, falling back to directory-based heuristic labels when the agent is unavailable.

### Hybrid Search

- **Hybrid retrieval** — FTS5 lexical (BM25) + vector cosine, fused via **Reciprocal Rank Fusion (RRF)** in a single consolidated retrieval core shared by the HTTP route and the MCP tool
- Vector embeddings via `@xenova/transformers` (local MiniLM model, no API calls); kill-switch `VK_DISABLE_EMBEDDINGS`
- Searches across **artifacts**, **tasks**, and **graph nodes** in one query; filter by entity type or search all
- Opt-in **recency decay**, **neighbor-chunk expansion** (adjacent chunks for surrounding context), and **per-entity result cap**
- Indexing stats panel; **backfill** button for re-embedding
- Returns ranked chunks with content snippets and fused scores

### Project Memory

An append-only memory of hard-won lessons per project, so past mistakes inform future AI runs.

- **Event types**: `decision`, `gotcha`, `attempt_failed`, `convention`, `fragile_file`
- **Origin**: `human` (manually recorded) or `ai_captured` (auto-mined from AI runs)
- **Append-only with supersession** — corrections chain via `supersededBy` rather than overwriting history
- **Auto-capture** — material lessons are mined from AI-run deviations/failures (via the `record_run_deviations` MCP tool), with usage-limit boilerplate filtered out
- **Injection** — relevant memory is injected as `<project_memory>` context into AI-resolve prompts
- **Vector-searchable** (`memory_embeddings`), single-project or cross-project
- **Memory tab** in the Knowledge workspace to browse, filter by type, and record entries

---

## Cross-Project Intelligence

Features that reason across **all** projects at once — turning the accumulated knowledge, memory, roadmaps, and tasks of every project into a single specialist.

### Cross-Project Search

- **Cross-project hybrid search** — the same FTS5 + vector RRF retrieval, projectId-optional: omit the project to rank across every project, with each hit attributed to its **source project**
- **Cross-project memory search** — semantic search over past lessons across all projects ("we hit this same bug in project B; here's what failed")
- REST: `POST /api/cross-project/knowledge/search`, `POST /api/cross-project/memory/search`
- MCP tools: `cross_project_search`, `cross_project_memory_search` (both global, no projectId)

### Supervisor (propose → approve → dispatch)

A cross-project supervisor that finds the highest-value work and opens it for review — the human stays in the loop.

- **Deterministic scan** (no LLM required) collects signals across all projects:
  - `roadmap` — planned, unstarted roadmap items
  - `finding` — unaddressed AI security/quality findings
  - `stalled` — tasks stuck in progress past a threshold
  - `unresolved` — failed attempts (`attempt_failed` memory) worth revisiting
- **Ranked + grounded proposals** — each is scored by a value heuristic and grounded with relevant cross-project knowledge + memory, then emitted as **idempotent backlog tasks** (`metadata.origin='supervisor'`, deduped on a stable signal key) — never a run, never a code change
- **Optional LLM-synthesis refinement** of the rationale (opt-in `VK_SUPERVISOR_SYNTHESIS_ENABLED`, default OFF; graceful fallback to the deterministic rationale)
- **Human-gated dispatch** — a reviewed proposal can be dispatched into the existing headless runner (isolated git worktree + adversarial verifiers, **never auto-merges**). Gated behind master switch `VK_SUPERVISOR_DISPATCH_ENABLED` (default OFF) **plus** an explicit per-proposal action; an atomic compare-and-set claim prevents double-runs
- **Supervisor panel** — scan, review proposals, and dispatch from the board toolbar
- REST: `POST /api/supervisor/scan`, `GET /api/supervisor/proposals`, `POST /api/supervisor/proposals/:taskId/dispatch`

### Specialist Chat

A conversational agent that answers grounded in every project, reachable **globally** from the sidebar.

- **Grounded engine** (default) — each turn first runs cross-project knowledge + memory search on your question, injects the hits as grounding, then streams the answer with **cited sources** (label + source project)
- **Agentic engine** (opt-in `VK_SPECIALIST_AGENTIC` + MCP enabled) — the model drives its **own multi-hop MCP tool calls** (`cross_project_search`, `cross_project_memory_search`, `list_projects`, `get_all_tasks`), rendered as inline tool-call steps. **Sandboxed** to those four read-only tools (no `--dangerously-skip-permissions`, no host shell/filesystem); uses the streamable-HTTP MCP transport; falls back to the grounded engine when MCP is unavailable
- Graceful degradation when embeddings are disabled (answers from general knowledge)

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
- Encrypted token used for GitHub API calls (CI status, etc.)

### CI Status

- GitHub Actions check status per branch
- Badge on task cards (success / failure / pending / running / unknown)
- Tooltip shows workflow name and run URL
- Batch-fetched for whole board to minimize API calls

---

## API Client (Postman / Bruno style)

- Dedicated route `/api-client` with project selector
- **Collections** sidebar — group requests per project, create / rename / delete
- **Request builder** — method (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS), URL, headers (key/value editor), body
- **Execute** requests directly from the UI (response status, time, headers, body)
- Tracks `lastResponseStatus` and `lastResponseTime` per request
- All state stored in SQLite per project

---

## Benchmarks

TDD-graded harness for the AI task-solving pipeline. Each fixture is a tiny self-contained codebase with a failing target test ("solved") and regression tests ("no breakage").

- **45+ fixtures** covering: bug fixes, feature adds, regression traps, orchestration, timeout recovery, frontier-hard problems, adversarial cases (no-test-edits, prompt-injection, no-env-exfil, scope-creep), server-integration fixtures (15–33)
- **Benchmarks UI** (`/benchmarks`):
  - Aggregate stats (runs, results scanned, total cost)
  - Hardest fixtures by solve-rate
  - **Trigger new runs** with fixture picker, `--mock`, `--mock-claude`, `--mode=pipeline`, parallel count
  - **Active runs** with live SSE log streaming
  - Per-run results: status badge, diff lines, duration, cost, AI metadata (models, turns, tokens, stop reason), chain depth, side-effects checks
  - **Re-run** individual fixtures or full reports
- Statuses: `SOLVED`, `TARGET-ONLY`, `MIS-FIXTURE`, `TAMPERED`, `ERROR`, `INJECTED-*`, `EXFIL`, `PROMPT-INJECTED`
- Replay system: env-gated capture + replay runner for deterministic re-grading
- Calibration mode: real-Claude n=3 calibration of frontier-hard and adversarial fixtures
- CLI: `bun run bench`, `bun run bench:dry`, `bun run bench:calibrate`
- Persistent run artifacts in `benchmarks/.runs/` (auto-cleaned unless `--keep`)
- CI gate: raw-baseline preflight check

---

## Terminal

- **Multi-session** with tabs: shell, dev server, Claude AI, AI resolve, AI test
- **xterm.js** terminal emulator with WebSocket streaming
- **PTY** via Bun's built-in API or `node-pty` (depending on runtime)
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

- **Read mode** — reference tool that pulls Notion data for display
- **Import mode** — pull a Notion database into project tasks (`POST /api/projects/:id/notion/import`)
- Configure Notion API key (internal integration token) in settings
- Link one Notion database per project
- **Notion panel** in project view lists pages from linked database
- Click a page to view full content rendered as markdown
- Converts Notion blocks (headings, paragraphs, lists, code, quotes, callouts, images) to markdown
- Simplifies database properties (multi-select, status, dates, checkboxes) to readable values
- 30s fetch timeout

---

## Google Sheets Sync

- **Bidirectional** sync via Google Apps Script proxy
- Push tasks on mutation (debounced 2s auto-push)
- Pull tasks from Google Sheets (30s polling)
- Anti-loop guard (10s after push)
- Per-project sync URL configuration
- URL validation: must match `https://script.google.com/macros/s/...`
- 30s fetch timeout

---

## MCP Server (Model Context Protocol)

Exposes project, task, artifact, and knowledge data to AI tools via JSON-RPC 2.0:

| Tool                          | Description                                                          |
| ----------------------------- | -------------------------------------------------------------------- |
| `list_projects`               | List all projects with names, paths, tech stacks                     |
| `get_project`                 | Get specific project details                                         |
| `list_tasks`                  | List tasks for a project, optionally filtered by status              |
| `get_task`                    | Get single task details                                              |
| `create_task`                 | Create a new task (also drives auto-spawn orchestration)             |
| `update_task`                 | Update task fields                                                   |
| `delete_task`                 | Delete a task                                                        |
| `get_all_tasks`               | All tasks across all projects (up to 100)                            |
| `git_status`                  | Git status for a project                                             |
| `git_diff`                    | Git diff for a project                                               |
| `list_artifacts`              | List knowledge-base artifacts for a project                          |
| `read_artifact`               | Read an artifact's content                                           |
| `list_graph_nodes`            | List knowledge-graph nodes for a project                             |
| `search_knowledge`            | Semantic vector search across artifacts, tasks, graph nodes          |
| `create_artifact`             | Create a knowledge-base artifact for a project                       |
| `attach_artifact_to_task`     | Link an artifact to a task                                           |
| `list_memory`                 | List a project's memory events                                       |
| `append_memory`               | Append a memory event to a project                                   |
| `record_run_deviations`       | Capture an AI run's deviations/failures into memory                  |
| `cross_project_search`        | **Hybrid search across ALL projects** (attributed to source project) |
| `cross_project_memory_search` | **Semantic search over memory across ALL projects**                  |

- SSE endpoint (`GET /mcp`) for streaming; JSON-RPC endpoint (`POST /mcp`); streamable-HTTP transport
- The four `list_projects` / `get_all_tasks` / `cross_project_*` tools are **global** (no `projectId`)
- Optional OAuth authentication with client registration
- Toggleable in settings (`mcpEnabled`, `mcpAuthRequired`)
- `search_knowledge` returns `minScore` and `totalChunks` for ranking transparency

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

- Categories: `server`, `git`, `claude`, `sync`, `terminal`, `mcp`, `tasks`, `files`
- Levels: `info`, `warn`, `error` (color-coded badges)
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

| Shortcut       | Action                                |
| -------------- | ------------------------------------- |
| `Ctrl+K`       | Command palette                       |
| `Ctrl+Shift+F` | Global search                         |
| `Ctrl+Shift+G` | File content search                   |
| `1`-`9`        | Quick navigate sidebar items          |
| `Ctrl+S`       | Save file in editor                   |
| `Ctrl+V`       | Paste screenshot (in tasks/artifacts) |
| `Escape`       | Close dialogs/overlays                |

---

## Settings

- **Claude AI**: API key, connection test, CLI availability status
- **GitHub**: Account management with encrypted tokens, per-project mappings
- **Notion**: API key, database linking status
- **Google Sheets**: Per-project sync URL
- **General**: Sound notifications toggle, terminal shell selection (bash/zsh/PowerShell/cmd)
- **MCP**: Enable/disable, auth requirement toggle, endpoint URL display
- **Data**: Full backup export (JSON), restore/import with validation
- **Project scan**: Add/remove scanned directories

---

## Onboarding

- Multi-step welcome wizard for first-time users
- Directory selection for project scanning
- Feature overview
- Skip option, completion state persisted in localStorage

---

## UI & Layout

- **Dark theme** by default with Tailwind v4 + OKLCH color system
- **Responsive layout** with collapsible sidebar
- **Sidebar navigation**: Dashboard, Tasks, Todos, API Client, Reports, Benchmarks, Logs, Settings, Help + project list with favorites first
- **Custom dialogs**: confirmation and alert components (no native browser dialogs)
- **Toast notifications** via sonner (success, error, info with auto-dismiss)
- **Skeleton loaders** during data fetching
- **Sound notifications** on AI task completion (toggleable)

---

## Tech Stack

| Layer       | Technology                                                                  |
| ----------- | --------------------------------------------------------------------------- |
| Runtime     | Bun (preferred) or Node.js — runtime abstraction switches the SQLite driver |
| Frontend    | React 18 + Vite 6 + Tailwind CSS v4 + shadcn/ui                             |
| Backend     | Fastify 5 + bun:sqlite (Bun) or better-sqlite3 (Node)                       |
| Terminal    | xterm.js over WebSocket (Bun built-in or node-pty)                          |
| Editor      | CodeMirror (@uiw/react-codemirror)                                          |
| Drag & Drop | @dnd-kit                                                                    |
| State       | TanStack Query v5 (server) + Zustand v5 with persist (client UI)            |
| Routing     | React Router v6 with lazy-loaded routes                                     |
| AI          | Claude CLI (subprocess) + Claude API (SSE streaming) + @anthropic-ai/sdk    |
| Embeddings  | @xenova/transformers (local, no API)                                        |
| Testing     | bun test (unit + integration) + Playwright (e2e) + Stryker (mutation)       |

---

## Data Architecture

- **SQLite** as single source of truth (`data/vibe-kanban.db`) with WAL mode
- **40+ versioned migrations** auto-applied on startup
- **JSON snapshots** written after each task mutation for Claude CLI file context (`data/tasks/{projectId}.json`)
- **Per-project artifact files** stored under `data/artifacts/{projectId}/`
- **In-memory terminal sessions** (not persisted across restarts)
- **Bun workspace monorepo**: `client/`, `server/`, `shared/`
- **Hybrid search index** — FTS5 virtual table (lexical) alongside vector embeddings, fused at query time via RRF
- **Vector embeddings** stored alongside source records in SQLite (knowledge + `memory_embeddings`)
- **Append-only project memory** (`project_memory`) with `supersededBy` chaining — history is never overwritten
