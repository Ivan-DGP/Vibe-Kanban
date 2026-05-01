import { getDb } from "../db";
import { spawn } from "../lib/spawn";
import { getProjectArtifactsDir } from "../lib/data-dir";
import type { McpToolDefinition } from "@vibe-kanban/shared";
import fs from "node:fs";
import path from "node:path";

interface ToolHandler {
  definition: McpToolDefinition;
  handler: (params: Record<string, unknown>) => unknown | Promise<unknown>;
}

export function listProjects(): unknown {
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

export function getProject(params: Record<string, unknown>): unknown {
  const db = getDb();
  const row = db.query("SELECT * FROM projects WHERE id = ?").get(params.projectId as string) as any;
  if (!row) return { error: "Project not found" };
  return { id: row.id, name: row.name, path: row.path, techStack: JSON.parse(row.techStack || "[]") };
}

export function listTasks(params: Record<string, unknown>): unknown {
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

export function getTask(params: Record<string, unknown>): unknown {
  const db = getDb();
  const row = db.query("SELECT id, title, description, prompt, status, priority, milestoneId FROM tasks WHERE id = ?")
    .get(params.taskId as string);
  if (!row) return { error: "Task not found" };
  return row;
}

export function createTask(params: Record<string, unknown>): unknown {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata = params.metadata && typeof params.metadata === "object"
    ? JSON.stringify(params.metadata)
    : "{}";
  db.query(
    "INSERT INTO tasks (id, projectId, title, description, status, priority, sortOrder, metadata, createdAt, updatedAt, inboxAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    params.projectId as string,
    params.title as string,
    (params.description as string) || null,
    (params.status as string) || "backlog",
    (params.priority as string) || "medium",
    Date.now(),
    metadata,
    now,
    now,
    now,
  );
  return { id, title: params.title };
}

export function updateTask(params: Record<string, unknown>): unknown {
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
  if (params.metadata !== undefined) {
    sets.push("metadata = ?");
    vals.push(
      params.metadata && typeof params.metadata === "object"
        ? JSON.stringify(params.metadata)
        : "{}",
    );
  }
  if (sets.length === 0) return { error: "No fields to update" };

  sets.push("updatedAt = ?");
  vals.push(now);
  vals.push(params.taskId as string);

  db.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as [string, ...string[]]));
  return { updated: true };
}

export function deleteTask(params: Record<string, unknown>): unknown {
  const db = getDb();
  db.query("DELETE FROM tasks WHERE id = ?").run(params.taskId as string);
  return { deleted: true };
}

export function getAllTasks(_params: Record<string, unknown>): unknown {
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

async function gitDiff(params: Record<string, unknown>): Promise<unknown> {
  const db = getDb();
  const project = db.query("SELECT path FROM projects WHERE id = ?").get(params.projectId as string) as any;
  if (!project) return { error: "Project not found" };
  try {
    const result = await spawn(["git", "diff", "HEAD", "--stat", "--patch", "--no-color"], { cwd: project.path, timeout: 10000 });
    if (result.exitCode !== 0) return { error: "git diff failed", stderr: result.stderr };
    const lines = result.stdout.split("\n");
    if (lines.length > 300) {
      const statResult = await spawn(["git", "diff", "HEAD", "--stat", "--no-color"], { cwd: project.path });
      return { stat: statResult.stdout.trim(), note: `Full diff too large (${lines.length} lines), showing stat only` };
    }
    return { diff: result.stdout.trim() || "(no changes)" };
  } catch (e: any) {
    return { error: e.message };
  }
}

export function listArtifacts(params: Record<string, unknown>): unknown {
  const db = getDb();
  const projectId = params.projectId as string;
  const rows = db.query(
    "SELECT id, filename, type, description, tags, sizeBytes, mimeType FROM project_artifacts WHERE projectId = ? ORDER BY updatedAt DESC LIMIT 50"
  ).all(projectId);
  return (rows as any[]).map((r) => ({
    ...r,
    tags: JSON.parse(r.tags || "[]"),
  }));
}

export function readArtifact(params: Record<string, unknown>): unknown {
  const db = getDb();
  const row = db.query(
    "SELECT * FROM project_artifacts WHERE id = ?"
  ).get(params.artifactId as string) as any;
  if (!row) return { error: "Artifact not found" };

  const artifactsDir = getProjectArtifactsDir(row.projectId);
  const ext = path.extname(row.filename) || ".md";
  const filePath = path.join(artifactsDir, row.id + ext);
  if (!fs.existsSync(filePath)) return { error: "File not found on disk" };

  const isText = row.mimeType.startsWith("text/") || row.mimeType === "application/json";
  if (!isText) return { id: row.id, filename: row.filename, note: "Binary file — cannot display content" };

  return {
    id: row.id,
    filename: row.filename,
    type: row.type,
    content: fs.readFileSync(filePath, "utf-8"),
  };
}

export function listGraphNodes(params: Record<string, unknown>): unknown {
  const db = getDb();
  const projectId = params.projectId as string;
  const nodes = (db.query(
    "SELECT id, label, type, description FROM project_graph_nodes WHERE projectId = ? ORDER BY createdAt ASC"
  ).all(projectId) as any[]);

  const edges = (db.query(
    "SELECT sourceNodeId, targetNodeId, label, type FROM project_graph_edges WHERE projectId = ?"
  ).all(projectId) as any[]);

  return { nodes, edges };
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
          status: { type: "string", description: "Filter by status (backlog, todo, in_progress, done, approved, archived)" },
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
      description: "Create a new task in a project. The metadata field is a JSON object for orchestration context (e.g. {type: 'qa-test', qa_scenario: '...', bug_report: {...}, parent_task: '<id>'}).",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string" },
          priority: { type: "string" },
          promptProfile: { type: "string", enum: ["auto", "quick-fix", "feature", "refactor", "bug-fix", "docs"] },
          metadata: { type: "object", description: "Arbitrary JSON metadata for orchestration." },
        },
        required: ["projectId", "title"],
      },
    },
    handler: createTask,
  },
  {
    definition: {
      name: "update_task",
      description: "Update an existing task. Pass metadata to replace the full metadata object.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string" },
          priority: { type: "string" },
          milestoneId: { type: "string" },
          promptProfile: { type: "string", enum: ["auto", "quick-fix", "feature", "refactor", "bug-fix", "docs"] },
          metadata: { type: "object", description: "Replaces the full metadata JSON object." },
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
  {
    definition: {
      name: "list_artifacts",
      description: "List knowledge base artifacts (docs, diagrams, specs) for a project",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string", description: "Project ID" } },
        required: ["projectId"],
      },
    },
    handler: listArtifacts,
  },
  {
    definition: {
      name: "read_artifact",
      description: "Read the content of a knowledge base artifact",
      inputSchema: {
        type: "object",
        properties: { artifactId: { type: "string", description: "Artifact ID" } },
        required: ["artifactId"],
      },
    },
    handler: readArtifact,
  },
  {
    definition: {
      name: "list_graph_nodes",
      description: "List knowledge graph nodes and edges for a project",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string", description: "Project ID" } },
        required: ["projectId"],
      },
    },
    handler: listGraphNodes,
  },
];

export const toolMap = new Map(tools.map((t) => [t.definition.name, t]));
