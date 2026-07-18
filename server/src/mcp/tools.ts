import { getDb } from "../db";
import { spawn } from "../lib/spawn";
import { getProjectArtifactsDir } from "../lib/data-dir";
import { maybeSpawnForTask } from "../services/taskSpawner";
import { rowToTask } from "../services/taskModel";
import {
  embed,
  cosineSimilarity,
  vectorFromBlob,
  EMBEDDING_MODEL,
  isEmbeddingsDisabled,
} from "../services/embeddings";
import { embedTaskInBackground } from "../services/taskEmbedder";
import { createArtifact, ArtifactError } from "../services/artifactService";
import type { McpToolDefinition, ArtifactType } from "@vibe-kanban/shared";
import fs from "node:fs";
import path from "node:path";

/** Per-call context, set when the call arrives on a per-run MCP endpoint.
 *  `cwd` points at that run's worktree; `runId` is the task_ai_runs id, which
 *  run-scoped tools (e.g. record_run_deviations) key their writes on. */
export interface ToolContext {
  cwd?: string;
  runId?: string;
}

interface ToolHandler {
  definition: McpToolDefinition;
  handler: (params: Record<string, unknown>, ctx?: ToolContext) => unknown | Promise<unknown>;
}

export function listProjects(): unknown {
  const db = getDb();
  const rows = db
    .query("SELECT id, name, path, techStack, favorite FROM projects ORDER BY name")
    .all();
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
  const row = db
    .query("SELECT * FROM projects WHERE id = ?")
    .get(params.projectId as string) as any;
  if (!row) return { error: "Project not found" };
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    techStack: JSON.parse(row.techStack || "[]"),
  };
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
  const row = db
    .query(
      "SELECT id, title, description, prompt, status, priority, milestoneId FROM tasks WHERE id = ?",
    )
    .get(params.taskId as string);
  if (!row) return { error: "Task not found" };
  return row;
}

export function createTask(params: Record<string, unknown>): unknown {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata =
    params.metadata && typeof params.metadata === "object" ? JSON.stringify(params.metadata) : "{}";
  db.query(
    "INSERT INTO tasks (id, projectId, title, description, status, priority, sortOrder, metadata, createdAt, updatedAt, inboxAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
  const inserted = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as any;
  if (inserted) {
    maybeSpawnForTask(rowToTask(inserted));
    embedTaskInBackground({
      projectId: inserted.projectId,
      taskId: inserted.id,
      title: inserted.title,
      description: inserted.description,
      prompt: inserted.prompt,
      status: inserted.status,
    });
  }
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

  db.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(
    ...(vals as [string, ...string[]]),
  );

  if (
    params.title !== undefined ||
    params.description !== undefined ||
    params.status !== undefined
  ) {
    const updated = db
      .query("SELECT * FROM tasks WHERE id = ?")
      .get(params.taskId as string) as any;
    if (updated) {
      embedTaskInBackground({
        projectId: updated.projectId,
        taskId: updated.id,
        title: updated.title,
        description: updated.description,
        prompt: updated.prompt,
        status: updated.status,
      });
    }
  }

  return { updated: true };
}

export function deleteTask(params: Record<string, unknown>): unknown {
  const db = getDb();
  db.query("DELETE FROM tasks WHERE id = ?").run(params.taskId as string);
  return { deleted: true };
}

export function getAllTasks(_params: Record<string, unknown>): unknown {
  const db = getDb();
  return db
    .query(
      "SELECT t.id, t.title, t.status, t.priority, p.name as projectName FROM tasks t JOIN projects p ON t.projectId = p.id ORDER BY t.updatedAt DESC LIMIT 100",
    )
    .all();
}

function gitStatus(params: Record<string, unknown>, ctx?: ToolContext): unknown {
  const db = getDb();
  const project = db
    .query("SELECT path FROM projects WHERE id = ?")
    .get(params.projectId as string) as any;
  if (!project) return { error: "Project not found" };
  // When invoked from a run's worktree endpoint, report that worktree's path.
  const cwd = ctx?.cwd ?? project.path;
  return {
    projectPath: cwd,
    isolated: !!ctx?.cwd,
    note: "Use git CLI for detailed status",
  };
}

async function gitDiff(params: Record<string, unknown>, ctx?: ToolContext): Promise<unknown> {
  const db = getDb();
  const project = db
    .query("SELECT path FROM projects WHERE id = ?")
    .get(params.projectId as string) as any;
  if (!project) return { error: "Project not found" };
  // Diff the run's worktree when available, else the project's main tree.
  const cwd = ctx?.cwd ?? project.path;
  try {
    const result = await spawn(["git", "diff", "HEAD", "--stat", "--patch", "--no-color"], {
      cwd,
      timeout: 10000,
    });
    if (result.exitCode !== 0) return { error: "git diff failed", stderr: result.stderr };
    const lines = result.stdout.split("\n");
    if (lines.length > 300) {
      const statResult = await spawn(["git", "diff", "HEAD", "--stat", "--no-color"], {
        cwd,
      });
      return {
        stat: statResult.stdout.trim(),
        note: `Full diff too large (${lines.length} lines), showing stat only`,
      };
    }
    return { diff: result.stdout.trim() || "(no changes)" };
  } catch (e: any) {
    return { error: e.message };
  }
}

export function listArtifacts(params: Record<string, unknown>): unknown {
  const db = getDb();
  const projectId = params.projectId as string;
  const rows = db
    .query(
      "SELECT id, filename, type, description, tags, sizeBytes, mimeType FROM project_artifacts WHERE projectId = ? ORDER BY updatedAt DESC LIMIT 50",
    )
    .all(projectId);
  return (rows as any[]).map((r) => ({
    ...r,
    tags: JSON.parse(r.tags || "[]"),
  }));
}

export function readArtifact(params: Record<string, unknown>): unknown {
  const db = getDb();
  const row = db
    .query("SELECT * FROM project_artifacts WHERE id = ?")
    .get(params.artifactId as string) as any;
  if (!row) return { error: "Artifact not found" };

  const artifactsDir = getProjectArtifactsDir(row.projectId);
  const ext = path.extname(row.filename) || ".md";
  const filePath = path.join(artifactsDir, row.id + ext);
  if (!fs.existsSync(filePath)) return { error: "File not found on disk" };

  const isText = row.mimeType.startsWith("text/") || row.mimeType === "application/json";
  if (!isText)
    return { id: row.id, filename: row.filename, note: "Binary file — cannot display content" };

  return {
    id: row.id,
    filename: row.filename,
    type: row.type,
    content: fs.readFileSync(filePath, "utf-8"),
  };
}

export function createArtifactTool(params: Record<string, unknown>): unknown {
  const projectId = params.projectId as string;
  const filename = params.filename as string;
  if (!projectId || !filename) return { error: "projectId and filename required" };
  try {
    const artifact = createArtifact({
      projectId,
      filename,
      type: params.type as ArtifactType | undefined,
      description: (params.description as string | undefined) ?? null,
      tags: Array.isArray(params.tags) ? (params.tags as string[]) : undefined,
      content: (params.content as string | undefined) ?? "",
    });
    return { id: artifact.id, filename: artifact.filename, type: artifact.type };
  } catch (e) {
    if (e instanceof ArtifactError) return { error: e.message };
    throw e;
  }
}

/** Record an artifact reference on a task's metadata under `artifacts:[{id, role}]`.
 *  Additive: preserves any existing metadata and de-dupes on (id, role). */
export function attachArtifactToTask(params: Record<string, unknown>): unknown {
  const db = getDb();
  const taskId = params.taskId as string;
  const artifactId = params.artifactId as string;
  const role = (params.role as string) || "reference";
  if (!taskId || !artifactId) return { error: "taskId and artifactId required" };

  const task = db.query("SELECT id, metadata FROM tasks WHERE id = ?").get(taskId) as
    | { id: string; metadata: string | null }
    | undefined;
  if (!task) return { error: "Task not found" };

  const artifact = db.query("SELECT id FROM project_artifacts WHERE id = ?").get(artifactId) as
    | { id: string }
    | undefined;
  if (!artifact) return { error: "Artifact not found" };

  let metadata: Record<string, unknown>;
  try {
    metadata = task.metadata ? (JSON.parse(task.metadata) as Record<string, unknown>) : {};
  } catch {
    metadata = {};
  }
  const artifacts = Array.isArray(metadata.artifacts)
    ? (metadata.artifacts as Array<{ id: string; role: string }>)
    : [];
  if (!artifacts.some((a) => a.id === artifactId && a.role === role)) {
    artifacts.push({ id: artifactId, role });
  }
  metadata.artifacts = artifacts;

  db.query("UPDATE tasks SET metadata = ?, updatedAt = ? WHERE id = ?").run(
    JSON.stringify(metadata),
    new Date().toISOString(),
    taskId,
  );
  return { taskId, artifacts };
}

/** Record the current run's deviations log into task_ai_runs.deviations.
 *  Run-scoped: keys on ctx.runId, so it only works from a per-run MCP endpoint. */
export function recordRunDeviations(params: Record<string, unknown>, ctx?: ToolContext): unknown {
  const runId = ctx?.runId;
  if (!runId) {
    return { error: "record_run_deviations requires a per-run MCP endpoint (no runId in context)" };
  }
  const db = getDb();
  const run = db.query("SELECT id FROM task_ai_runs WHERE id = ?").get(runId) as
    | { id: string }
    | undefined;
  if (!run) return { error: "Run not found" };

  const notes = typeof params.notes === "string" ? params.notes : undefined;
  const artifactId = typeof params.artifactId === "string" ? params.artifactId : undefined;
  if (!notes && !artifactId) return { error: "notes or artifactId required" };

  db.query("UPDATE task_ai_runs SET deviations = ? WHERE id = ?").run(
    JSON.stringify({ notes, artifactId }),
    runId,
  );
  return { runId, recorded: { notes, artifactId } };
}

export function listGraphNodes(params: Record<string, unknown>): unknown {
  const db = getDb();
  const projectId = params.projectId as string;
  const nodes = db
    .query(
      "SELECT id, label, type, description FROM project_graph_nodes WHERE projectId = ? ORDER BY createdAt ASC",
    )
    .all(projectId) as any[];

  const edges = db
    .query(
      "SELECT sourceNodeId, targetNodeId, label, type FROM project_graph_edges WHERE projectId = ?",
    )
    .all(projectId) as any[];

  return { nodes, edges };
}

export async function searchKnowledge(params: Record<string, unknown>): Promise<unknown> {
  const projectId = params.projectId as string;
  const query = (params.query as string)?.trim();
  const k = Math.min(Math.max(Number(params.k) || 5, 1), 20);
  const minScore = Number.isFinite(Number(params.minScore)) ? Number(params.minScore) : 0;
  const types = Array.isArray(params.types) ? (params.types as string[]) : null;
  const includeArtifacts = !types || types.includes("artifact");
  const includeTasks = !types || types.includes("task");

  if (!projectId || !query) return { error: "projectId and query required" };

  // Kill-switch: with embeddings disabled, return empty WITHOUT loading the
  // model or reading embedding rows.
  if (isEmbeddingsDisabled()) {
    return { query, model: EMBEDDING_MODEL, results: [], totalChunks: 0 };
  }

  const db = getDb();
  const scored: any[] = [];

  // Embed the query once and reuse the vector across all branches.
  const queryVec = await embed(query);

  if (includeArtifacts) {
    const artifactRows = db
      .query(
        `SELECT e.artifactId, e.chunkIdx, e.content, e.vector,
              a.filename, a.type, a.description
       FROM artifact_embeddings e
       JOIN project_artifacts a ON a.id = e.artifactId
       WHERE e.projectId = ?`,
      )
      .all(projectId) as any[];

    if (artifactRows.length > 0) {
      for (const row of artifactRows) {
        scored.push({
          kind: "artifact",
          artifactId: row.artifactId,
          filename: row.filename,
          type: row.type,
          description: row.description,
          chunkIdx: row.chunkIdx,
          content: row.content,
          score: cosineSimilarity(queryVec, vectorFromBlob(row.vector)),
        });
      }
    }
  }

  if (includeTasks) {
    const taskRows = db
      .query(
        `SELECT e.taskId, e.chunkIdx, e.content, e.vector,
              t.title, t.status, t.priority, t.taskNumber
       FROM task_embeddings e
       JOIN tasks t ON t.id = e.taskId
       WHERE e.projectId = ?`,
      )
      .all(projectId) as any[];

    if (taskRows.length > 0) {
      for (const row of taskRows) {
        scored.push({
          kind: "task",
          taskId: row.taskId,
          title: row.title,
          status: row.status,
          priority: row.priority,
          taskNumber: row.taskNumber,
          chunkIdx: row.chunkIdx,
          content: row.content,
          score: cosineSimilarity(queryVec, vectorFromBlob(row.vector)),
        });
      }
    }
  }

  const includeGraphNodes = !types || types.includes("graph_node");
  if (includeGraphNodes) {
    const nodeRows = db
      .query(
        `SELECT e.nodeId, e.chunkIdx, e.content, e.vector,
              n.label, n.type, n.description
       FROM graph_node_embeddings e
       JOIN project_graph_nodes n ON n.id = e.nodeId
       WHERE e.projectId = ?`,
      )
      .all(projectId) as any[];

    if (nodeRows.length > 0) {
      for (const row of nodeRows) {
        scored.push({
          kind: "graph_node",
          nodeId: row.nodeId,
          label: row.label,
          nodeType: row.type,
          description: row.description,
          chunkIdx: row.chunkIdx,
          content: row.content,
          score: cosineSimilarity(queryVec, vectorFromBlob(row.vector)),
        });
      }
    }
  }

  if (scored.length === 0) {
    return {
      query,
      model: EMBEDDING_MODEL,
      results: [],
      note: "No embeddings yet — POST to /api/projects/:id/knowledge/backfill",
    };
  }

  scored.sort((a, b) => b.score - a.score);
  const filtered = scored.filter((s) => s.score >= minScore).slice(0, k);
  return { query, model: EMBEDDING_MODEL, results: filtered, totalChunks: scored.length };
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
          status: {
            type: "string",
            description: "Filter by status (backlog, todo, in_progress, done, approved, archived)",
          },
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
      description:
        "Create a new task in a project. The metadata field is a JSON object for orchestration context (e.g. {type: 'qa-test', qa_scenario: '...', bug_report: {...}, parent_task: '<id>'}).",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string" },
          priority: { type: "string" },
          promptProfile: {
            type: "string",
            enum: ["auto", "quick-fix", "feature", "refactor", "bug-fix", "docs"],
          },
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
          promptProfile: {
            type: "string",
            enum: ["auto", "quick-fix", "feature", "refactor", "bug-fix", "docs"],
          },
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
      name: "create_artifact",
      description:
        "Create a knowledge base artifact (spec, notes, prototype, quiz, doc) for a project. Content is written to disk, embedded for semantic search, and its [[wikilinks]] are resolved into the knowledge graph — so it auto-grounds future AI resolve runs. Use filename extensions like .md, .html, .json to set the type.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project ID" },
          filename: {
            type: "string",
            description: "Filename incl. extension, e.g. 'auth-spec.md' or 'prototype.html'",
          },
          content: { type: "string", description: "Text content of the artifact" },
          type: {
            type: "string",
            enum: ["document", "diagram", "image", "research", "spec", "other"],
            description: "Artifact type (default 'document')",
          },
          description: { type: "string", description: "Optional one-line description" },
          tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
        },
        required: ["projectId", "filename"],
      },
    },
    handler: createArtifactTool,
  },
  {
    definition: {
      name: "attach_artifact_to_task",
      description:
        "Link an existing artifact to a task, recording it under the task's metadata.artifacts as {id, role}. Roles like 'spec', 'prototype', 'impl-notes', 'quiz' let downstream tooling find the right artifact for a task. Additive and idempotent.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID" },
          artifactId: { type: "string", description: "Artifact ID" },
          role: {
            type: "string",
            description: "Relationship role, e.g. spec | prototype | impl-notes | quiz | reference",
          },
        },
        required: ["taskId", "artifactId"],
      },
    },
    handler: attachArtifactToTask,
  },
  {
    definition: {
      name: "record_run_deviations",
      description:
        "Record how this AI run diverged from its plan, for audit. Keyed to the current run automatically. Pass `notes` (free-text deviations log) and/or `artifactId` (the impl-notes artifact you authored via create_artifact). Call once near the end of a run, after logging deviations into an impl-notes artifact.",
      inputSchema: {
        type: "object",
        properties: {
          notes: {
            type: "string",
            description: "Free-text summary of deviations from the original plan",
          },
          artifactId: {
            type: "string",
            description: "ID of the impl-notes artifact authored for this run",
          },
        },
      },
    },
    handler: recordRunDeviations,
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
  {
    definition: {
      name: "search_knowledge",
      description:
        "Semantic search across a project's artifacts (docs/specs/diagrams), tasks (title + description + prompt), and knowledge graph nodes (label + type + description). Returns ranked chunks. Each result has a 'kind' field ('artifact', 'task', or 'graph_node') and the corresponding entity metadata.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project ID" },
          query: { type: "string", description: "Natural-language search query" },
          k: { type: "number", description: "Number of results to return (default 5, max 20)" },
          minScore: {
            type: "number",
            description:
              "Optional cosine-similarity floor (0–1). Hits below this score are dropped. Default 0.",
          },
          types: {
            type: "array",
            items: { type: "string", enum: ["artifact", "task", "graph_node"] },
            description: "Optional: restrict search to specific kinds. Default: all three.",
          },
        },
        required: ["projectId", "query"],
      },
    },
    handler: searchKnowledge,
  },
];

export const toolMap = new Map(tools.map((t) => [t.definition.name, t]));
