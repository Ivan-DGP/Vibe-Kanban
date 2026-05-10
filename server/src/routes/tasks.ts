import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { log } from "../lib/logger";
import { writeTaskSnapshot } from "../services/snapshot";
import {
  buildAiResolvePrompt,
  buildDecomposePrompt,
  classifyTaskProfile,
  estimateComplexity,
} from "../services/aiResolvePrompt";
import { maybeSpawnForTask } from "../services/taskSpawner";
import { embedTaskInBackground } from "../services/taskEmbedder";
import type { Task, TaskStatus } from "@vibe-kanban/shared";

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export function rowToTask(row: any): Task {
  if (!row) return row;
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

export function applyTimestampCascade(
  task: Partial<Task>,
  newStatus: TaskStatus,
): Record<string, string> {
  const ts = now();
  const updates: Record<string, string> = { updatedAt: ts };

  if (newStatus === "backlog" || newStatus === "todo") {
    if (!task.inboxAt) updates.inboxAt = ts;
  }
  if (newStatus === "in_progress") {
    if (!task.inboxAt) updates.inboxAt = ts;
    if (!task.inProgressAt) updates.inProgressAt = ts;
  }
  if (newStatus === "done") {
    if (!task.inboxAt) updates.inboxAt = ts;
    if (!task.inProgressAt) updates.inProgressAt = ts;
    if (!task.doneAt) updates.doneAt = ts;
  }
  if (newStatus === "approved") {
    if (!task.inboxAt) updates.inboxAt = ts;
    if (!task.inProgressAt) updates.inProgressAt = ts;
    if (!task.doneAt) updates.doneAt = ts;
    if (!task.approvedAt) updates.approvedAt = ts;
  }
  if (newStatus === "archived") {
    if (!task.inboxAt) updates.inboxAt = ts;
    if (!task.inProgressAt) updates.inProgressAt = ts;
    if (!task.doneAt) updates.doneAt = ts;
    if (!task.approvedAt) updates.approvedAt = ts;
    if (!task.archivedAt) updates.archivedAt = ts;
  }

  return updates;
}

const taskRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // List tasks for a project
  fastify.get("/projects/:projectId/tasks", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const {
      status,
      milestoneId,
      search,
      sort,
      limit = "15",
      offset = "0",
    } = request.query as {
      status?: string;
      milestoneId?: string;
      search?: string;
      sort?: string;
      limit?: string;
      offset?: string;
    };

    let sql = "SELECT * FROM tasks WHERE projectId = ?";
    const params: any[] = [projectId];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (milestoneId === "null" || milestoneId === "general") {
      sql += " AND milestoneId IS NULL";
    } else if (milestoneId) {
      sql += " AND milestoneId = ?";
      params.push(milestoneId);
    }
    if (search) {
      sql += " AND (title LIKE ? OR description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    switch (sort) {
      case "priority":
        sql +=
          " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, sortOrder";
        break;
      case "newest":
        sql += " ORDER BY createdAt DESC";
        break;
      case "oldest":
        sql += " ORDER BY createdAt ASC";
        break;
      case "updated":
        sql += " ORDER BY updatedAt DESC";
        break;
      default:
        sql += " ORDER BY sortOrder ASC";
    }

    // Count total
    const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as total");
    const countResult = db.prepare(countSql).get(...params) as { total: number };

    sql += " LIMIT ? OFFSET ?";
    params.push(parseInt(limit), parseInt(offset));

    const items = (db.prepare(sql).all(...params) as any[]).map(rowToTask);
    return {
      items,
      total: countResult.total,
      hasMore: parseInt(offset) + parseInt(limit) < countResult.total,
    };
  });

  // List all tasks across all projects
  fastify.get("/tasks/all", async (request) => {
    const {
      status,
      sort = "updated",
      limit = "50",
      offset = "0",
    } = request.query as { status?: string; sort?: string; limit?: string; offset?: string };
    let orderBy = "t.updatedAt DESC";
    if (sort === "priority")
      orderBy =
        "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, t.updatedAt DESC";
    if (sort === "newest") orderBy = "t.createdAt DESC";
    if (sort === "oldest") orderBy = "t.createdAt ASC";

    const where = status ? "WHERE t.status = ?" : "";
    const params: unknown[] = status ? [status] : [];

    const rows = (
      db
        .prepare(
          `SELECT t.*, p.name as projectName FROM tasks t JOIN projects p ON t.projectId = p.id ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        )
        .all(...(params as string[]), parseInt(limit), parseInt(offset)) as any[]
    ).map((r) => ({ ...rowToTask(r), projectName: r.projectName }));

    const countResult = db
      .prepare(`SELECT COUNT(*) as total FROM tasks t ${where}`)
      .get(...(params as string[])) as { total: number };

    return { items: rows, total: countResult.total };
  });

  // Search tasks across projects
  fastify.get("/tasks/search", async (request) => {
    const { q } = request.query as { q?: string };
    if (!q) return [];
    const rows = (
      db
        .prepare(
          "SELECT t.*, p.name as projectName FROM tasks t JOIN projects p ON t.projectId = p.id WHERE t.title LIKE ? OR t.description LIKE ? ORDER BY t.updatedAt DESC LIMIT 50",
        )
        .all(`%${q}%`, `%${q}%`) as any[]
    ).map((r) => ({ ...rowToTask(r), projectName: r.projectName }));
    return rows;
  });

  // Working on (in-progress tasks)
  fastify.get("/tasks/working-on", async () => {
    return (
      db
        .prepare(
          "SELECT t.*, p.name as projectName FROM tasks t JOIN projects p ON t.projectId = p.id WHERE t.status = 'in_progress' ORDER BY t.updatedAt DESC",
        )
        .all() as any[]
    ).map((r) => ({ ...rowToTask(r), projectName: r.projectName }));
  });

  // Get single task
  fastify.get("/tasks/:id", async (request, reply) => {
    const { id } = request.params as any;
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    return rowToTask(task);
  });

  // Create task
  fastify.post("/projects/:projectId/tasks", async (request) => {
    const { projectId } = request.params as any;
    const {
      title,
      description,
      prompt,
      branch,
      promptProfile = "auto",
      status = "backlog",
      priority = "medium",
      milestoneId,
      parentTaskId,
      metadata,
    } = request.body as any;

    const id = uuid();
    const ts = now();

    // Get max sortOrder for the status column
    const maxOrder = db
      .prepare("SELECT MAX(sortOrder) as m FROM tasks WHERE projectId = ? AND status = ?")
      .get(projectId, status) as { m: number | null };
    const sortOrder = (maxOrder?.m ?? 0) + 1;

    // Get next task number for this project
    const maxNum = db
      .prepare("SELECT MAX(taskNumber) as m FROM tasks WHERE projectId = ?")
      .get(projectId) as { m: number | null };
    const taskNumber = (maxNum?.m ?? 0) + 1;

    // Apply timestamp cascade
    const cascaded = applyTimestampCascade({}, status as TaskStatus);

    const metadataJson = metadata && typeof metadata === "object" ? JSON.stringify(metadata) : "{}";

    db.prepare(
      `INSERT INTO tasks (id, projectId, milestoneId, parentTaskId, title, description, prompt, branch, promptProfile, status, priority, taskNumber, sortOrder, inboxAt, inProgressAt, doneAt, approvedAt, archivedAt, metadata, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      milestoneId || null,
      parentTaskId || null,
      title,
      description || null,
      prompt || null,
      branch || null,
      promptProfile,
      status,
      priority,
      taskNumber,
      sortOrder,
      cascaded.inboxAt || null,
      cascaded.inProgressAt || null,
      cascaded.doneAt || null,
      cascaded.approvedAt || null,
      cascaded.archivedAt || null,
      metadataJson,
      ts,
      ts,
    );

    log("info", "tasks", `Task created: ${title}`, { projectId });
    writeTaskSnapshot(projectId);

    const task = rowToTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id));
    embedTaskInBackground({
      projectId,
      taskId: id,
      title,
      description: description || null,
      prompt: prompt || null,
      status,
    });
    maybeSpawnForTask(task);
    return task;
  });

  // Update task
  fastify.patch("/tasks/:id", async (request, reply) => {
    const { id } = request.params as any;
    const updates = request.body as any;

    const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    if (!existing) return reply.code(404).send({ error: "Task not found" });

    const fields: string[] = [];
    const values: any[] = [];

    // Apply timestamp cascade if status is changing
    if (updates.status && updates.status !== existing.status) {
      const cascaded = applyTimestampCascade(existing, updates.status);
      for (const [key, value] of Object.entries(cascaded)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    for (const [key, value] of Object.entries(updates)) {
      if (
        [
          "title",
          "description",
          "prompt",
          "branch",
          "promptProfile",
          "status",
          "priority",
          "sortOrder",
        ].includes(key)
      ) {
        fields.push(`${key} = ?`);
        values.push(value ?? null);
      } else if (key === "milestoneId") {
        fields.push("milestoneId = ?");
        values.push(value || null);
      } else if (key === "metadata") {
        fields.push("metadata = ?");
        values.push(value && typeof value === "object" ? JSON.stringify(value) : "{}");
      }
    }

    if (fields.length === 0) return rowToTask(existing);

    if (!fields.some((f) => f.startsWith("updatedAt"))) {
      fields.push("updatedAt = ?");
      values.push(now());
    }

    values.push(id);
    db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    writeTaskSnapshot(existing.projectId);
    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    if (
      updates.title !== undefined ||
      updates.description !== undefined ||
      updates.prompt !== undefined ||
      updates.status !== undefined
    ) {
      embedTaskInBackground({
        projectId: updated.projectId,
        taskId: id,
        title: updated.title,
        description: updated.description,
        prompt: updated.prompt,
        status: updated.status,
      });
    }
    return rowToTask(updated);
  });

  // Delete task
  fastify.delete("/tasks/:id", async (request, reply) => {
    const { id } = request.params as any;
    const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    if (!existing) return reply.code(404).send({ error: "Task not found" });

    db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    log("info", "tasks", `Task deleted: ${existing.title}`);
    writeTaskSnapshot(existing.projectId);
    return reply.code(204).send();
  });

  // Reorder tasks
  fastify.patch("/tasks/reorder", async (request) => {
    const { tasks } = request.body as {
      tasks: { id: string; sortOrder: number; status?: string }[];
    };

    const projectIds = new Set<string>();

    db.transaction(() => {
      for (const task of tasks) {
        if (task.status) {
          const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id) as any;
          if (existing) {
            const cascaded =
              task.status !== existing.status
                ? applyTimestampCascade(existing, task.status as TaskStatus)
                : {};
            db.prepare(
              `UPDATE tasks SET sortOrder = ?, status = ?, ${Object.keys(cascaded)
                .map((k) => `${k} = ?`)
                .join(", ")}${Object.keys(cascaded).length ? "," : ""} updatedAt = ? WHERE id = ?`,
            ).run(task.sortOrder, task.status, ...Object.values(cascaded), now(), task.id);
            projectIds.add(existing.projectId);
          }
        } else {
          db.prepare("UPDATE tasks SET sortOrder = ?, updatedAt = ? WHERE id = ?").run(
            task.sortOrder,
            now(),
            task.id,
          );
          const existing = db
            .prepare("SELECT projectId FROM tasks WHERE id = ?")
            .get(task.id) as any;
          if (existing) projectIds.add(existing.projectId);
        }
      }
    })();

    for (const pid of projectIds) {
      writeTaskSnapshot(pid);
    }

    return { ok: true };
  });

  // Archive all approved tasks for a project
  fastify.post("/projects/:projectId/tasks/archive-approved", async (request) => {
    const { projectId } = request.params as any;
    const ts = now();

    const approved = db
      .prepare("SELECT * FROM tasks WHERE projectId = ? AND status = 'approved'")
      .all(projectId) as Task[];
    if (approved.length === 0) return { archived: 0 };

    db.transaction(() => {
      for (const task of approved) {
        const cascaded = applyTimestampCascade(task, "archived" as TaskStatus);
        db.prepare(
          `UPDATE tasks SET status = 'archived', archivedAt = ?, ${Object.keys(cascaded)
            .map((k) => `${k} = ?`)
            .join(", ")} WHERE id = ?`,
        ).run(ts, ...Object.values(cascaded), task.id);
      }
    })();

    log("info", "tasks", `Archived ${approved.length} approved tasks`, { projectId });
    writeTaskSnapshot(projectId);
    return { archived: approved.length };
  });

  // Bulk import
  fastify.post("/projects/:projectId/tasks/bulk-import", async (request) => {
    const { projectId } = request.params as any;
    const { tasks } = request.body as { tasks: any[] };

    const created: any[] = [];
    const insertedIds: string[] = [];

    db.transaction(() => {
      // Get starting task number for this project
      const maxNum = db
        .prepare("SELECT MAX(taskNumber) as m FROM tasks WHERE projectId = ?")
        .get(projectId) as { m: number | null };
      let nextNumber = (maxNum?.m ?? 0) + 1;

      // Pre-fetch max sort orders per status to avoid N+1 queries
      const sortOrderMap = new Map<string, number>();
      const rows = db
        .prepare(
          "SELECT status, MAX(sortOrder) as m FROM tasks WHERE projectId = ? GROUP BY status",
        )
        .all(projectId) as { status: string; m: number | null }[];
      for (const row of rows) sortOrderMap.set(row.status, row.m ?? 0);

      for (const taskInput of tasks) {
        const id = uuid();
        const ts = now();
        const status = taskInput.status || "backlog";
        const priority = taskInput.priority || "medium";

        const sortOrder = (sortOrderMap.get(status) ?? 0) + 1;
        sortOrderMap.set(status, sortOrder);

        const cascaded = applyTimestampCascade({}, status);

        db.prepare(
          `INSERT INTO tasks (id, projectId, title, description, prompt, branch, promptProfile, status, priority, taskNumber, sortOrder, inboxAt, inProgressAt, doneAt, approvedAt, archivedAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          projectId,
          taskInput.title,
          taskInput.description || null,
          taskInput.prompt || null,
          taskInput.branch || null,
          taskInput.promptProfile || "auto",
          status,
          priority,
          nextNumber++,
          sortOrder,
          cascaded.inboxAt || null,
          cascaded.inProgressAt || null,
          cascaded.doneAt || null,
          cascaded.approvedAt || null,
          cascaded.archivedAt || null,
          ts,
          ts,
        );

        insertedIds.push(id);
      }
    })();

    // Batch-fetch all created tasks outside the transaction
    const selectStmt = db.prepare("SELECT * FROM tasks WHERE id = ?");
    for (const id of insertedIds) created.push(rowToTask(selectStmt.get(id)));

    log("info", "tasks", `Bulk imported ${created.length} tasks`, { projectId });
    writeTaskSnapshot(projectId);
    for (const t of created) {
      embedTaskInBackground({
        projectId,
        taskId: t.id,
        title: t.title,
        description: t.description,
        prompt: t.prompt,
        status: t.status,
      });
    }
    return created;
  });

  // AI Pre-flight - lightweight analysis before spawning AI resolve
  fastify.get("/projects/:projectId/tasks/:taskId/ai-preflight", async (request, reply) => {
    const { projectId, taskId } = request.params as any;
    const task = db
      .prepare("SELECT * FROM tasks WHERE id = ? AND projectId = ?")
      .get(taskId, projectId) as Task | undefined;
    if (!task) return reply.code(404).send({ error: "Task not found" });

    // Resolve effective profile
    const detectedProfile = classifyTaskProfile(task);
    const effectiveProfile = task.promptProfile === "auto" ? detectedProfile : task.promptProfile;

    // Estimate scope from content
    const scope = estimateComplexity(task);

    // Check if task description is actionable
    const hasDescription = !!task.description?.trim();
    const hasPrompt = !!task.prompt?.trim();
    const warnings: string[] = [];
    if (!hasDescription && !hasPrompt) {
      warnings.push(
        "Task has no description or technical details — AI may produce generic results",
      );
    }
    if (task.title.length < 10) {
      warnings.push("Task title is very short — consider adding more detail");
    }

    return {
      taskId: task.id,
      title: task.title,
      detectedProfile,
      effectiveProfile,
      scope,
      hasDescription,
      hasPrompt,
      warnings,
      branch: task.branch,
    };
  });

  // Decompose task into subtasks via AI
  fastify.post("/projects/:projectId/tasks/:taskId/decompose", async (request, reply) => {
    const { projectId, taskId } = request.params as any;
    const task = db
      .prepare("SELECT * FROM tasks WHERE id = ? AND projectId = ?")
      .get(taskId, projectId) as Task | undefined;
    if (!task) return reply.code(404).send({ error: "Task not found" });

    const prompt = await buildDecomposePrompt(task, projectId);

    // Call Claude to generate subtasks
    const { spawnProcess } = await import("../lib/runtime");

    let responseText = "";
    try {
      // Try CLI first
      const whichCmd = process.platform === "win32" ? "where" : "which";
      const whichResult = await spawnProcess([whichCmd, "claude"], { cwd: "." });
      if (whichResult.exitCode === 0) {
        const result = await spawnProcess(["claude", "-p", "--output-format", "text"], {
          cwd: ".",
          timeout: 60000,
          stdinData: prompt,
        });
        responseText = result.stdout;
      } else {
        throw new Error("CLI not available");
      }
    } catch {
      // Fall back to API
      const apiKeyRow = db
        .prepare("SELECT value FROM settings WHERE key = 'claudeApiKey'")
        .get() as any;
      const apiKey = apiKeyRow ? JSON.parse(apiKeyRow.value) || apiKeyRow.value : null;
      if (!apiKey) return reply.code(500).send({ error: "No AI backend available" });

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = (await res.json()) as any;
      responseText = data.content?.[0]?.text || "";
    }

    // Parse JSON array from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return reply.code(500).send({ error: "AI did not return valid subtasks" });

    let subtaskInputs: any[];
    try {
      subtaskInputs = JSON.parse(jsonMatch[0]);
    } catch {
      return reply.code(500).send({ error: "Failed to parse AI response as JSON" });
    }

    if (!Array.isArray(subtaskInputs) || subtaskInputs.length === 0) {
      return reply.code(500).send({ error: "AI returned empty subtask list" });
    }

    // Create subtasks in DB — pre-fetch max values to avoid N+1 queries
    const createdTasks: any[] = [];
    const insertedSubIds: string[] = [];
    let nextSortOrder =
      ((
        db
          .prepare("SELECT MAX(sortOrder) as m FROM tasks WHERE projectId = ? AND status = 'todo'")
          .get(projectId) as { m: number | null }
      )?.m ?? 0) + 1;
    let nextTaskNumber =
      ((
        db.prepare("SELECT MAX(taskNumber) as m FROM tasks WHERE projectId = ?").get(projectId) as {
          m: number | null;
        }
      )?.m ?? 0) + 1;

    for (const input of subtaskInputs) {
      const id = uuid();
      const ts = now();

      db.prepare(
        `INSERT INTO tasks (id, projectId, milestoneId, parentTaskId, title, description, prompt, branch, promptProfile, status, priority, taskNumber, sortOrder, inboxAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        projectId,
        task.milestoneId || null,
        taskId,
        input.title || "Untitled subtask",
        input.description || null,
        input.prompt || null,
        task.branch || null,
        input.promptProfile || "feature",
        input.priority || task.priority,
        nextTaskNumber++,
        nextSortOrder++,
        ts,
        ts,
        ts,
      );

      insertedSubIds.push(id);
    }
    const selectStmt = db.prepare("SELECT * FROM tasks WHERE id = ?");
    for (const id of insertedSubIds) createdTasks.push(rowToTask(selectStmt.get(id)));

    log("info", "tasks", `Decomposed task "${task.title}" into ${createdTasks.length} subtasks`, {
      projectId,
    });
    writeTaskSnapshot(projectId);

    for (const t of createdTasks) {
      embedTaskInBackground({
        projectId,
        taskId: t.id,
        title: t.title,
        description: t.description,
        prompt: t.prompt,
        status: t.status,
      });
    }

    return { parentTaskId: taskId, subtasks: createdTasks };
  });

  // AI Resolve - generate structured prompt for Claude CLI
  fastify.post("/projects/:projectId/tasks/:taskId/ai-resolve", async (request, reply) => {
    const { projectId, taskId } = request.params as any;
    const task = db
      .prepare("SELECT * FROM tasks WHERE id = ? AND projectId = ?")
      .get(taskId, projectId) as Task | undefined;
    if (!task) return reply.code(404).send({ error: "Task not found" });

    const port = parseInt(process.env.PORT || "3001", 10);
    const prompt = await buildAiResolvePrompt(task, projectId, port);
    return { prompt };
  });

  // Record an AI run result
  fastify.post("/tasks/:taskId/ai-runs", async (request, reply) => {
    const { taskId } = request.params as any;
    const { sessionId, profile, complexity, exitCode, success, filesChanged, durationMs, summary } =
      request.body as any;

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
    if (!task) return reply.code(404).send({ error: "Task not found" });

    const id = uuid();
    db.prepare(
      `INSERT INTO task_ai_runs (id, taskId, projectId, sessionId, profile, complexity, exitCode, success, filesChanged, durationMs, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      taskId,
      task.projectId,
      sessionId || null,
      profile || "feature",
      complexity || "medium",
      exitCode ?? null,
      success ? 1 : 0,
      filesChanged ?? null,
      durationMs ?? null,
      summary || null,
    );

    return db.prepare("SELECT * FROM task_ai_runs WHERE id = ?").get(id);
  });

  // Get AI runs for a task
  fastify.get("/tasks/:taskId/ai-runs", async (request) => {
    const { taskId } = request.params as any;
    return db
      .prepare("SELECT * FROM task_ai_runs WHERE taskId = ? ORDER BY createdAt DESC LIMIT 20")
      .all(taskId);
  });

  // Get adversarial findings for a task (TAMPERED, SPRAWL, EXFIL, PROMPT-INJECTED, PREFLIGHT-RED)
  fastify.get("/tasks/:taskId/findings", async (request) => {
    const { taskId } = request.params as any;
    return db
      .prepare(
        "SELECT id, runId, kind, detail, createdAt FROM task_ai_findings WHERE taskId = ? ORDER BY createdAt DESC LIMIT 50",
      )
      .all(taskId);
  });

  // Get project AI stats
  fastify.get("/projects/:projectId/ai-stats", async (request) => {
    const { projectId } = request.params as any;

    const total = db
      .prepare("SELECT COUNT(*) as count FROM task_ai_runs WHERE projectId = ?")
      .get(projectId) as { count: number };
    const successes = db
      .prepare("SELECT COUNT(*) as count FROM task_ai_runs WHERE projectId = ? AND success = 1")
      .get(projectId) as { count: number };
    const avgDuration = db
      .prepare(
        "SELECT AVG(durationMs) as avg FROM task_ai_runs WHERE projectId = ? AND durationMs IS NOT NULL",
      )
      .get(projectId) as { avg: number | null };

    const profileRows = db
      .prepare(
        "SELECT profile, COUNT(*) as count FROM task_ai_runs WHERE projectId = ? GROUP BY profile",
      )
      .all(projectId) as { profile: string; count: number }[];
    const profileBreakdown: Record<string, number> = {};
    for (const row of profileRows) profileBreakdown[row.profile] = row.count;

    return {
      totalRuns: total.count,
      successCount: successes.count,
      successRate: total.count > 0 ? Math.round((successes.count / total.count) * 100) : 0,
      avgDurationMs: avgDuration.avg ? Math.round(avgDuration.avg) : null,
      commonFailures: [],
      profileBreakdown,
    };
  });
};

export default taskRoutes;
