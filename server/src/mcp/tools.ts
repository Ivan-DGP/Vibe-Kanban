import { getDb } from "../db";
import type { McpToolDefinition } from "@vibe-kanban/shared";

interface ToolHandler {
  definition: McpToolDefinition;
  handler: (params: Record<string, unknown>) => unknown;
}

function listProjects(): unknown {
  const db = getDb();
  const rows = db.query("SELECT id, name, path, techStack, favorite FROM projects ORDER BY name").all();
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    path: r.path,
    techStack: JSON.parse(r.techStack || "[]"),
    favorite: !!r.favorite,
  }));
}

function getProject(params: Record<string, unknown>): unknown {
  const db = getDb();
  const row = db.query("SELECT * FROM projects WHERE id = ?").get(params.projectId as string) as any;
  if (!row) return { error: "Project not found" };
  return { id: row.id, name: row.name, path: row.path, techStack: JSON.parse(row.techStack || "[]") };
}

function listTasks(params: Record<string, unknown>): unknown {
  const db = getDb();
  const projectId = params.projectId as string;
  const status = params.status as string | undefined;
  let sql = "SELECT id, title, status, priority FROM tasks WHERE projectId = ?";
  const bindings: unknown[] = [projectId];
  if (status) {
    sql += " AND status = ?";
    bindings.push(status);
  }
  sql += " ORDER BY sortOrder LIMIT 50";
  return db.query(sql).all(...(bindings as [string, ...string[]]));
}

function getTask(params: Record<string, unknown>): unknown {
  const db = getDb();
  const row = db.query("SELECT id, title, description, prompt, status, priority, milestoneId FROM tasks WHERE id = ?")
    .get(params.taskId as string);
  if (!row) return { error: "Task not found" };
  return row;
}

function createTask(params: Record<string, unknown>): unknown {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.query(
    "INSERT INTO tasks (id, projectId, title, description, status, priority, sortOrder, createdAt, updatedAt, inboxAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    params.projectId as string,
    params.title as string,
    (params.description as string) || null,
    (params.status as string) || "backlog",
    (params.priority as string) || "medium",
    Date.now(),
    now,
    now,
    now,
  );
  return { id, title: params.title };
}

function updateTask(params: Record<string, unknown>): unknown {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const now = new Date().toISOString();

  for (const key of ["title", "description", "status", "priority", "milestoneId"]) {
    if (params[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(params[key]);
    }
  }
  if (sets.length === 0) return { error: "No fields to update" };

  sets.push("updatedAt = ?");
  vals.push(now);
  vals.push(params.taskId as string);

  db.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as [string, ...string[]]));
  return { updated: true };
}

function deleteTask(params: Record<string, unknown>): unknown {
  const db = getDb();
  db.query("DELETE FROM tasks WHERE id = ?").run(params.taskId as string);
  return { deleted: true };
}

function getAllTasks(params: Record<string, unknown>): unknown {
  const db = getDb();
  return db.query(
    "SELECT t.id, t.title, t.status, t.priority, p.name as projectName FROM tasks t JOIN projects p ON t.projectId = p.id ORDER BY t.updatedAt DESC LIMIT 100"
  ).all();
}

function gitStatus(params: Record<string, unknown>): unknown {
  const db = getDb();
  const project = db.query("SELECT path FROM projects WHERE id = ?").get(params.projectId as string) as any;
  if (!project) return { error: "Project not found" };
  // Return minimal info — full git status requires spawning
  return { projectPath: project.path, note: "Use git CLI for detailed status" };
}

function gitDiff(params: Record<string, unknown>): unknown {
  return { note: "Use git CLI for diffs", projectId: params.projectId };
}

export const tools: ToolHandler[] = [
  {
    definition: {
      name: "list_projects",
      description: "List all projects with names, paths, and tech stacks",
      inputSchema: { type: "object", properties: {} },
    },
    handler: listProjects,
  },
  {
    definition: {
      name: "get_project",
      description: "Get details for a specific project",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string", description: "Project ID" } },
        required: ["projectId"],
      },
    },
    handler: getProject,
  },
  {
    definition: {
      name: "list_tasks",
      description: "List tasks for a project, optionally filtered by status",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project ID" },
          status: { type: "string", description: "Filter by status (backlog, todo, in_progress, done)" },
        },
        required: ["projectId"],
      },
    },
    handler: listTasks,
  },
  {
    definition: {
      name: "get_task",
      description: "Get full details for a specific task",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string", description: "Task ID" } },
        required: ["taskId"],
      },
    },
    handler: getTask,
  },
  {
    definition: {
      name: "create_task",
      description: "Create a new task in a project",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string" },
          priority: { type: "string" },
        },
        required: ["projectId", "title"],
      },
    },
    handler: createTask,
  },
  {
    definition: {
      name: "update_task",
      description: "Update an existing task",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string" },
          priority: { type: "string" },
          milestoneId: { type: "string" },
        },
        required: ["taskId"],
      },
    },
    handler: updateTask,
  },
  {
    definition: {
      name: "delete_task",
      description: "Delete a task by ID",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
      },
    },
    handler: deleteTask,
  },
  {
    definition: {
      name: "get_all_tasks",
      description: "Get all tasks across all projects (up to 100, most recently updated first)",
      inputSchema: { type: "object", properties: {} },
    },
    handler: getAllTasks,
  },
  {
    definition: {
      name: "git_status",
      description: "Get git status info for a project",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
    },
    handler: gitStatus,
  },
  {
    definition: {
      name: "git_diff",
      description: "Get git diff for a project",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
    },
    handler: gitDiff,
  },
];

export const toolMap = new Map(tools.map((t) => [t.definition.name, t]));
