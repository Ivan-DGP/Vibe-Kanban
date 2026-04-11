# Vibe Kanban API Guide

Base URL: `http://localhost:3001/api`

All requests and responses use JSON. Set `Content-Type: application/json` for POST/PATCH/PUT requests.

---

## Projects

### List Projects

```bash
curl http://localhost:3001/api/projects
```

### Create a Project

```bash
curl -X POST http://localhost:3001/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "My App", "path": "/home/user/projects/my-app"}'
```

### Update a Project

```bash
curl -X PATCH http://localhost:3001/api/projects/{id} \
  -H "Content-Type: application/json" \
  -d '{"favorite": true, "category": "frontend"}'
```

### Delete a Project

```bash
curl -X DELETE http://localhost:3001/api/projects/{id}
```

---

## Tasks

### List Tasks for a Project

```bash
curl "http://localhost:3001/api/projects/{projectId}/tasks"
```

Query params: `status`, `milestoneId`, `search`, `sort` (priority|newest|oldest|updated), `limit` (default 15), `offset` (default 0).

```bash
# Get only in-progress tasks, sorted by priority
curl "http://localhost:3001/api/projects/{projectId}/tasks?status=in_progress&sort=priority"
```

### Create a Task

```bash
curl -X POST http://localhost:3001/api/projects/{projectId}/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Add user authentication",
    "description": "Implement JWT-based auth with login/register flows",
    "prompt": "Create an auth module using bcrypt for password hashing and JWT for tokens. Add login and register API endpoints under /api/auth.",
    "status": "todo",
    "priority": "high"
  }'
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Task name |
| `description` | string | no | Human-readable description |
| `prompt` | string | no | Instructions for AI resolve |
| `branch` | string | no | Git branch for this task |
| `promptProfile` | string | no | AI profile (e.g. `careful`, `fast`) |
| `status` | string | no | `backlog`, `todo`, `in_progress`, `done` (default: `backlog`) |
| `priority` | string | no | `low`, `medium`, `high`, `urgent` (default: `medium`) |
| `milestoneId` | string | no | Assign to a milestone |

### Update a Task

```bash
curl -X PATCH http://localhost:3001/api/tasks/{taskId} \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress", "priority": "urgent"}'
```

### Delete a Task

```bash
curl -X DELETE http://localhost:3001/api/tasks/{taskId}
```

### Bulk Import Tasks

Create multiple tasks at once:

```bash
curl -X POST http://localhost:3001/api/projects/{projectId}/tasks/bulk-import \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {"title": "Set up CI pipeline", "priority": "high", "status": "todo"},
      {"title": "Write unit tests", "priority": "medium", "status": "todo"},
      {"title": "Add error monitoring", "priority": "low", "status": "backlog"}
    ]
  }'
```

### Reorder Tasks

```bash
curl -X PATCH http://localhost:3001/api/tasks/reorder \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {"id": "task-1", "sortOrder": 0, "status": "todo"},
      {"id": "task-2", "sortOrder": 1, "status": "todo"},
      {"id": "task-3", "sortOrder": 2, "status": "in_progress"}
    ]
  }'
```

### Search Tasks Across Projects

```bash
curl "http://localhost:3001/api/tasks/search?q=authentication"
```

### Get All In-Progress Tasks

```bash
curl http://localhost:3001/api/tasks/working-on
```

---

## AI Resolve

AI resolve uses Claude CLI to autonomously work on tasks. Each task needs a `prompt` field with instructions for what the AI should do.

### Preflight Check

Check if a task is ready for AI resolve:

```bash
curl http://localhost:3001/api/projects/{projectId}/tasks/{taskId}/ai-preflight
```

Returns detected profile, scope, warnings, and whether the task has the required fields.

### Generate AI Resolve Prompt

Get the structured prompt that will be sent to Claude CLI:

```bash
curl -X POST http://localhost:3001/api/projects/{projectId}/tasks/{taskId}/ai-resolve
```

Returns `{"prompt": "..."}` with the full context-enriched prompt.

### Batch AI Resolve

Resolve multiple tasks in parallel using Claude CLI:

```bash
curl -X POST http://localhost:3001/api/terminal/batch-resolve \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "your-project-id",
    "taskIds": ["task-1", "task-2", "task-3"],
    "concurrency": 2
  }'
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | string | yes | Project to resolve tasks in |
| `taskIds` | string[] | yes | Array of task IDs to resolve |
| `concurrency` | number | no | How many tasks to run in parallel (default: 1) |
| `overrideBranch` | string | no | Use this branch instead of task-specific branches |

### Check Batch Resolve Status

```bash
curl http://localhost:3001/api/terminal/batch-resolve/status
```

Response:

```json
{
  "state": "running",
  "projectId": "...",
  "totalTasks": 3,
  "completedTasks": 1,
  "concurrency": 2,
  "currentTaskId": "task-2",
  "activeTasks": ["task-2", "task-3"],
  "taskResults": [
    {"taskId": "task-1", "success": true}
  ]
}
```

States: `idle`, `running`, `completed`, `cancelled`.

### Cancel Batch Resolve

```bash
curl -X POST http://localhost:3001/api/terminal/batch-resolve/cancel
```

### AI Run History

Record and retrieve AI run results:

```bash
# Record a run
curl -X POST http://localhost:3001/api/tasks/{taskId}/ai-runs \
  -H "Content-Type: application/json" \
  -d '{
    "profile": "careful",
    "exitCode": 0,
    "success": true,
    "filesChanged": 5,
    "durationMs": 45000,
    "summary": "Added auth module with JWT tokens"
  }'

# Get run history
curl http://localhost:3001/api/tasks/{taskId}/ai-runs

# Get project-level AI stats
curl http://localhost:3001/api/projects/{projectId}/ai-stats
```

---

## Milestones

### List Milestones

```bash
curl http://localhost:3001/api/projects/{projectId}/milestones
```

### Create a Milestone

```bash
curl -X POST http://localhost:3001/api/projects/{projectId}/milestones \
  -H "Content-Type: application/json" \
  -d '{"name": "v1.0 Launch"}'
```

### Update a Milestone

```bash
curl -X PATCH http://localhost:3001/api/milestones/{id} \
  -H "Content-Type: application/json" \
  -d '{"name": "v1.0 Launch", "status": "active", "aiInstructions": "Focus on stability"}'
```

### Delete a Milestone

```bash
curl -X DELETE http://localhost:3001/api/milestones/{id}
```

---

## Git Operations

All git endpoints are scoped to a project. Optional `subPath` query/body param targets sub-repos.

```bash
# Status
curl http://localhost:3001/api/projects/{projectId}/git/status

# Log (last 30 commits)
curl http://localhost:3001/api/projects/{projectId}/git/log

# Branches
curl http://localhost:3001/api/projects/{projectId}/git/branches

# Stage all files
curl -X POST http://localhost:3001/api/projects/{projectId}/git/stage \
  -H "Content-Type: application/json" -d '{}'

# Stage specific files
curl -X POST http://localhost:3001/api/projects/{projectId}/git/stage \
  -H "Content-Type: application/json" \
  -d '{"files": ["src/auth.ts", "src/routes/login.ts"]}'

# Commit
curl -X POST http://localhost:3001/api/projects/{projectId}/git/commit \
  -H "Content-Type: application/json" \
  -d '{"message": "feat: add authentication module"}'

# Push
curl -X POST http://localhost:3001/api/projects/{projectId}/git/push \
  -H "Content-Type: application/json" -d '{}'

# Pull
curl -X POST http://localhost:3001/api/projects/{projectId}/git/pull \
  -H "Content-Type: application/json" -d '{}'

# Create branch
curl -X POST http://localhost:3001/api/projects/{projectId}/git/create-branch \
  -H "Content-Type: application/json" \
  -d '{"branch": "feature/auth", "baseBranch": "main"}'

# Checkout branch
curl -X POST http://localhost:3001/api/projects/{projectId}/git/checkout \
  -H "Content-Type: application/json" \
  -d '{"branch": "feature/auth"}'

# Diff
curl "http://localhost:3001/api/projects/{projectId}/git/diff?staged=true"
```

---

## Claude AI Chat

### Check Claude Availability

```bash
curl http://localhost:3001/api/claude/status
```

### Chat (SSE Stream)

```bash
curl -N -X POST http://localhost:3001/api/claude/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How should I structure the auth module?", "projectId": "your-project-id"}'
```

Returns Server-Sent Events: `{"type":"delta","text":"..."}`, then `{"type":"done"}`.

### Analyze a Task (SSE Stream)

```bash
curl -N -X POST http://localhost:3001/api/claude/analyze \
  -H "Content-Type: application/json" \
  -d '{"projectId": "your-project-id", "taskId": "your-task-id"}'
```

### AI Bulk Import from Text

Parse unstructured text (meeting notes, ideas, etc.) into structured tasks:

```bash
curl -X POST http://localhost:3001/api/claude/bulk-import \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "your-project-id",
    "text": "We need to add login page, fix the broken search, and update the docs for v2"
  }'
```

---

## Terminal Sessions

### Create a Terminal Session

```bash
curl -X POST http://localhost:3001/api/terminal/sessions \
  -H "Content-Type: application/json" \
  -d '{"projectId": "your-project-id", "type": "shell"}'
```

Types: `shell`, `dev`, `claude-ai`, `ai-resolve`.

### List Sessions

```bash
curl http://localhost:3001/api/terminal/sessions
```

### Connect via WebSocket

```
ws://localhost:3001/ws/terminal/{sessionId}
```

Send: `{"type":"input","data":"ls\n"}` | Receive: `{"type":"output","data":"..."}`

---

## MCP (Model Context Protocol)

The MCP endpoint exposes tools for external AI clients (e.g. Claude Desktop, Cursor).

```bash
# List available tools
curl -X POST http://localhost:3001/mcp/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Call a tool
curl -X POST http://localhost:3001/mcp/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {"name": "list_projects", "arguments": {}},
    "id": 2
  }'
```

Available MCP tools: `list_projects`, `list_tasks`, `create_task`, `update_task`, `git_status`, `git_diff`, and more.

---

## Common Workflows

### Create a project and add tasks for batch AI resolve

```bash
# 1. Create the project
PROJECT=$(curl -s -X POST http://localhost:3001/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "My App", "path": "/home/user/my-app"}')
PROJECT_ID=$(echo $PROJECT | jq -r '.id')

# 2. Bulk import tasks with AI prompts
TASKS=$(curl -s -X POST http://localhost:3001/api/projects/$PROJECT_ID/tasks/bulk-import \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "title": "Set up Express server",
        "prompt": "Initialize an Express.js server with TypeScript, health check endpoint, and CORS config.",
        "status": "todo",
        "priority": "high"
      },
      {
        "title": "Add user model",
        "prompt": "Create a User model with Prisma. Fields: id, email, name, passwordHash, createdAt.",
        "status": "todo",
        "priority": "high"
      },
      {
        "title": "Add auth endpoints",
        "prompt": "Create POST /auth/register and POST /auth/login using bcrypt and JWT.",
        "status": "todo",
        "priority": "medium"
      }
    ]
  }')

# 3. Extract task IDs
TASK_IDS=$(echo $TASKS | jq '[.[].id]')

# 4. Run batch AI resolve
curl -X POST http://localhost:3001/api/terminal/batch-resolve \
  -H "Content-Type: application/json" \
  -d "{\"projectId\": \"$PROJECT_ID\", \"taskIds\": $TASK_IDS, \"concurrency\": 2}"

# 5. Poll status until done
curl http://localhost:3001/api/terminal/batch-resolve/status
```

### Move tasks through the kanban flow

```bash
# Backlog -> Todo
curl -X PATCH http://localhost:3001/api/tasks/{taskId} \
  -H "Content-Type: application/json" -d '{"status": "todo"}'

# Todo -> In Progress
curl -X PATCH http://localhost:3001/api/tasks/{taskId} \
  -H "Content-Type: application/json" -d '{"status": "in_progress"}'

# In Progress -> Done
curl -X PATCH http://localhost:3001/api/tasks/{taskId} \
  -H "Content-Type: application/json" -d '{"status": "done"}'
```

Status timestamps cascade automatically: setting `in_progress` also sets `inboxAt` if missing, setting `done` sets both `inboxAt` and `inProgressAt` if missing.
