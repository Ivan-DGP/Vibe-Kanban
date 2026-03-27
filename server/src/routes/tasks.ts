import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { log } from "../lib/logger";
import { writeTaskSnapshot } from "../services/snapshot";
import { buildAiResolvePrompt } from "../services/aiResolvePrompt";
import type { Task, TaskStatus } from "@vibe-kanban/shared";

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function applyTimestampCascade(
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

  return updates;
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const taskRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // List tasks for a project
  fastify.get("/projects/:projectId/tasks", async (request) => {
    const { projectId } = request.params as any;
    const { status, milestoneId, search, sort, limit = "15", offset = "0" } =
      request.query as any;

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
        sql += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, sortOrder";
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

    const items = db.prepare(sql).all(...params);
    return {
      items,
      total: countResult.total,
      hasMore: parseInt(offset) + parseInt(limit) < countResult.total,
    };
  });

  // List all tasks across all projects
  fastify.get("/tasks/all", async (request) => {
    const { status, sort = "updated", limit = "50", offset = "0" } = request.query as any;
    let orderBy = "t.updatedAt DESC";
    if (sort === "priority") orderBy = "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, t.updatedAt DESC";
    if (sort === "newest") orderBy = "t.createdAt DESC";
    if (sort === "oldest") orderBy = "t.createdAt ASC";

    const where = status ? "WHERE t.status = ?" : "";
    const params: unknown[] = status ? [status] : [];

    const rows = db
      .prepare(
        `SELECT t.*, p.name as projectName FROM tasks t JOIN projects p ON t.projectId = p.id ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      )
      .all(...(params as string[]), parseInt(limit), parseInt(offset));

    const countResult = db
      .prepare(`SELECT COUNT(*) as total FROM tasks t ${where}`)
      .get(...(params as string[])) as { total: number };

    return { items: rows, total: countResult.total };
  });

  // Search tasks across projects
  fastify.get("/tasks/search", async (request) => {
    const { q } = request.query as any;
    if (!q) return [];
    const rows = db
      .prepare(
        "SELECT t.*, p.name as projectName FROM tasks t JOIN projects p ON t.projectId = p.id WHERE t.title LIKE ? OR t.description LIKE ? ORDER BY t.updatedAt DESC LIMIT 50",
      )
      .all(`%${q}%`, `%${q}%`);
    return rows;
  });

  // Working on (in-progress tasks)
  fastify.get("/tasks/working-on", async () => {
    return db
      .prepare(
        "SELECT t.*, p.name as projectName FROM tasks t JOIN projects p ON t.projectId = p.id WHERE t.status = 'in_progress' ORDER BY t.updatedAt DESC",
      )
      .all();
  });

  // Get single task
  fastify.get("/tasks/:id", async (request, reply) => {
    const { id } = request.params as any;
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    return task;
  });

  // Create task
  fastify.post("/projects/:projectId/tasks", async (request) => {
    const { projectId } = request.params as any;
    const { title, description, prompt, branch, status = "backlog", priority = "medium", milestoneId } =
      request.body as any;

    const id = uuid();
    const ts = now();

    // Get max sortOrder for the status column
    const maxOrder = db
      .prepare(
        "SELECT MAX(sortOrder) as m FROM tasks WHERE projectId = ? AND status = ?",
      )
      .get(projectId, status) as { m: number | null };
    const sortOrder = (maxOrder?.m ?? 0) + 1;

    // Get next task number for this project
    const maxNum = db
      .prepare("SELECT MAX(taskNumber) as m FROM tasks WHERE projectId = ?")
      .get(projectId) as { m: number | null };
    const taskNumber = (maxNum?.m ?? 0) + 1;

    // Apply timestamp cascade
    const cascaded = applyTimestampCascade({}, status as TaskStatus);

    db.prepare(
      `INSERT INTO tasks (id, projectId, milestoneId, title, description, prompt, branch, status, priority, taskNumber, sortOrder, inboxAt, inProgressAt, doneAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      milestoneId || null,
      title,
      description || null,
      prompt || null,
      branch || null,
      status,
      priority,
      taskNumber,
      sortOrder,
      cascaded.inboxAt || null,
      cascaded.inProgressAt || null,
      cascaded.doneAt || null,
      ts,
      ts,
    );

    log("info", "tasks", `Task created: ${title}`, { projectId });
    writeTaskSnapshot(projectId);

    return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
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
      if (["title", "description", "prompt", "branch", "status", "priority", "sortOrder"].includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value ?? null);
      } else if (key === "milestoneId") {
        fields.push("milestoneId = ?");
        values.push(value || null);
      }
    }

    if (fields.length === 0) return existing;

    if (!fields.some((f) => f.startsWith("updatedAt"))) {
      fields.push("updatedAt = ?");
      values.push(now());
    }

    values.push(id);
    db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(
      ...values,
    );

    writeTaskSnapshot(existing.projectId);
    return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
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
          const existing = db
            .prepare("SELECT * FROM tasks WHERE id = ?")
            .get(task.id) as any;
          if (existing) {
            const cascaded =
              task.status !== existing.status
                ? applyTimestampCascade(existing, task.status as TaskStatus)
                : {};
            db.prepare(
              `UPDATE tasks SET sortOrder = ?, status = ?, ${Object.keys(cascaded).map((k) => `${k} = ?`).join(", ")}${Object.keys(cascaded).length ? "," : ""} updatedAt = ? WHERE id = ?`,
            ).run(
              task.sortOrder,
              task.status,
              ...Object.values(cascaded),
              now(),
              task.id,
            );
            projectIds.add(existing.projectId);
          }
        } else {
          db.prepare(
            "UPDATE tasks SET sortOrder = ?, updatedAt = ? WHERE id = ?",
          ).run(task.sortOrder, now(), task.id);
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

  // Bulk import
  fastify.post("/projects/:projectId/tasks/bulk-import", async (request) => {
    const { projectId } = request.params as any;
    const { tasks } = request.body as { tasks: any[] };

    const created: any[] = [];

    db.transaction(() => {
      // Get starting task number for this project
      const maxNum = db
        .prepare("SELECT MAX(taskNumber) as m FROM tasks WHERE projectId = ?")
        .get(projectId) as { m: number | null };
      let nextNumber = (maxNum?.m ?? 0) + 1;

      for (const taskInput of tasks) {
        const id = uuid();
        const ts = now();
        const status = taskInput.status || "backlog";
        const priority = taskInput.priority || "medium";

        const maxOrder = db
          .prepare(
            "SELECT MAX(sortOrder) as m FROM tasks WHERE projectId = ? AND status = ?",
          )
          .get(projectId, status) as { m: number | null };
        const sortOrder = (maxOrder?.m ?? 0) + 1;

        const cascaded = applyTimestampCascade({}, status);

        db.prepare(
          `INSERT INTO tasks (id, projectId, title, description, prompt, branch, status, priority, taskNumber, sortOrder, inboxAt, inProgressAt, doneAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          projectId,
          taskInput.title,
          taskInput.description || null,
          taskInput.prompt || null,
          taskInput.branch || null,
          status,
          priority,
          nextNumber++,
          sortOrder,
          cascaded.inboxAt || null,
          cascaded.inProgressAt || null,
          cascaded.doneAt || null,
          ts,
          ts,
        );

        created.push(
          db.prepare("SELECT * FROM tasks WHERE id = ?").get(id),
        );
      }
    })();

    log("info", "tasks", `Bulk imported ${created.length} tasks`, { projectId });
    writeTaskSnapshot(projectId);
    return created;
  });

  // AI Resolve - generate structured prompt for Claude CLI
  fastify.post("/projects/:projectId/tasks/:taskId/ai-resolve", async (request, reply) => {
    const { projectId, taskId } = request.params as any;
    const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND projectId = ?").get(taskId, projectId) as Task | undefined;
    if (!task) return reply.code(404).send({ error: "Task not found" });

    const port = parseInt(process.env.PORT || "3001", 10);
    const prompt = await buildAiResolvePrompt(task, projectId, port);
    return { prompt };
  });
};

export default taskRoutes;
