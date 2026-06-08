import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";

// Rollup contract: a task counts as "done" when status IN ('done','approved').

const roadmapRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // Resolve a milestone strictly within a project. Returns true if valid.
  const milestoneInProject = (milestoneId: string, projectId: string): boolean =>
    !!db
      .prepare("SELECT id FROM milestones WHERE id = ? AND projectId = ?")
      .get(milestoneId, projectId);

  // Return the subset of taskIds NOT belonging to the project (unknown or cross-project).
  const invalidTaskIds = (taskIds: string[], projectId: string): string[] => {
    if (!taskIds.length) return [];
    const placeholders = taskIds.map(() => "?").join(",");
    const found = db
      .prepare(`SELECT id FROM tasks WHERE projectId = ? AND id IN (${placeholders})`)
      .all(projectId, ...taskIds) as { id: string }[];
    const valid = new Set(found.map((r) => r.id));
    return [...new Set(taskIds)].filter((id) => !valid.has(id));
  };

  const setTaskLinks = (roadmapItemId: string, taskIds: string[]): void => {
    db.prepare("DELETE FROM roadmap_item_tasks WHERE roadmapItemId = ?").run(roadmapItemId);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO roadmap_item_tasks (roadmapItemId, taskId) VALUES (?, ?)",
    );
    for (const taskId of new Set(taskIds)) insert.run(roadmapItemId, taskId);
  };

  // List roadmap items for a project, with task/milestone rollups
  fastify.get("/projects/:projectId/roadmap", async (request) => {
    const { projectId } = request.params as any;
    const rows = db
      .prepare(
        "SELECT * FROM roadmap_items WHERE projectId = ? ORDER BY sortOrder ASC, createdAt ASC",
      )
      .all(projectId) as any[];
    if (!rows.length) return [];

    // taskIds per item (single query)
    const links = db
      .prepare(
        `SELECT rit.roadmapItemId AS roadmapItemId, rit.taskId AS taskId
         FROM roadmap_item_tasks rit
         JOIN roadmap_items ri ON ri.id = rit.roadmapItemId
         WHERE ri.projectId = ?`,
      )
      .all(projectId) as { roadmapItemId: string; taskId: string }[];

    // Task-link rollup keyed by roadmapItemId (single grouped query)
    const taskRollup = db
      .prepare(
        `SELECT rit.roadmapItemId AS roadmapItemId,
                COUNT(*) AS total,
                SUM(CASE WHEN t.status IN ('done','approved') THEN 1 ELSE 0 END) AS done
         FROM roadmap_item_tasks rit
         JOIN tasks t ON t.id = rit.taskId
         JOIN roadmap_items ri ON ri.id = rit.roadmapItemId
         WHERE ri.projectId = ?
         GROUP BY rit.roadmapItemId`,
      )
      .all(projectId) as { roadmapItemId: string; total: number; done: number }[];

    // Milestone rollup keyed by milestoneId (single grouped query, project-scoped)
    const milestoneRollup = db
      .prepare(
        `SELECT milestoneId,
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ('done','approved') THEN 1 ELSE 0 END) AS done
         FROM tasks
         WHERE projectId = ? AND milestoneId IS NOT NULL
         GROUP BY milestoneId`,
      )
      .all(projectId) as { milestoneId: string; total: number; done: number }[];

    const taskIdsByItem = new Map<string, string[]>();
    for (const l of links) {
      const arr = taskIdsByItem.get(l.roadmapItemId) ?? [];
      arr.push(l.taskId);
      taskIdsByItem.set(l.roadmapItemId, arr);
    }
    const taskRollupByItem = new Map(taskRollup.map((r) => [r.roadmapItemId, r]));
    const milestoneRollupById = new Map(milestoneRollup.map((r) => [r.milestoneId, r]));

    return rows.map((row) => {
      const tr = taskRollupByItem.get(row.id);
      const mr = row.milestoneId ? milestoneRollupById.get(row.milestoneId) : undefined;
      return {
        ...parseRoadmapRow(row),
        taskIds: taskIdsByItem.get(row.id) ?? [],
        tasksTotal: tr?.total ?? 0,
        tasksDone: tr?.done ?? 0,
        milestoneTasksTotal: row.milestoneId ? (mr?.total ?? 0) : null,
        milestoneTasksDone: row.milestoneId ? (mr?.done ?? 0) : null,
      };
    });
  });

  // Create roadmap item
  fastify.post("/projects/:projectId/roadmap", async (request, reply) => {
    const { projectId } = request.params as any;
    const {
      title,
      description,
      status = "planned",
      milestoneId,
      startDate,
      endDate,
      dependsOn = [],
      color,
      taskIds = [],
    } = request.body as any;

    if (milestoneId && !milestoneInProject(milestoneId, projectId)) {
      return reply.code(400).send({ error: "Unknown milestoneId for this project" });
    }
    if (Array.isArray(taskIds) && taskIds.length) {
      const bad = invalidTaskIds(taskIds, projectId);
      if (bad.length) {
        return reply
          .code(400)
          .send({ error: `Unknown taskId(s) for this project: ${bad.join(", ")}` });
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Get next sort order
    const last = db
      .prepare("SELECT MAX(sortOrder) as maxOrder FROM roadmap_items WHERE projectId = ?")
      .get(projectId) as any;
    const sortOrder = (last?.maxOrder ?? 0) + 1;

    db.prepare(
      `INSERT INTO roadmap_items (id, projectId, milestoneId, title, description, status, startDate, endDate, dependsOn, color, sortOrder, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      milestoneId || null,
      title,
      description || null,
      status,
      startDate || null,
      endDate || null,
      JSON.stringify(dependsOn),
      color || null,
      sortOrder,
      now,
      now,
    );

    if (Array.isArray(taskIds) && taskIds.length) setTaskLinks(id, taskIds);

    return buildItem(id);
  });

  // Update roadmap item
  fastify.patch("/roadmap/:id", async (request, reply) => {
    const { id } = request.params as any;
    const body = request.body as any;

    const existing = db.prepare("SELECT * FROM roadmap_items WHERE id = ?").get(id) as any;
    if (!existing) return reply.code(404).send({ error: "Roadmap item not found" });
    const projectId = existing.projectId;

    if (body.milestoneId !== undefined && body.milestoneId !== null) {
      if (!milestoneInProject(body.milestoneId, projectId)) {
        return reply.code(400).send({ error: "Unknown milestoneId for this project" });
      }
    }
    if (body.taskIds !== undefined) {
      if (!Array.isArray(body.taskIds)) {
        return reply.code(400).send({ error: "taskIds must be an array" });
      }
      const bad = invalidTaskIds(body.taskIds, projectId);
      if (bad.length) {
        return reply
          .code(400)
          .send({ error: `Unknown taskId(s) for this project: ${bad.join(", ")}` });
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    const now = new Date().toISOString();

    if (body.title !== undefined) {
      fields.push("title = ?");
      values.push(body.title);
    }
    if (body.description !== undefined) {
      fields.push("description = ?");
      values.push(body.description);
    }
    if (body.status !== undefined) {
      fields.push("status = ?");
      values.push(body.status);
    }
    if (body.milestoneId !== undefined) {
      fields.push("milestoneId = ?");
      values.push(body.milestoneId);
    }
    if (body.startDate !== undefined) {
      fields.push("startDate = ?");
      values.push(body.startDate);
    }
    if (body.endDate !== undefined) {
      fields.push("endDate = ?");
      values.push(body.endDate);
    }
    if (body.dependsOn !== undefined) {
      fields.push("dependsOn = ?");
      values.push(JSON.stringify(body.dependsOn));
    }
    if (body.color !== undefined) {
      fields.push("color = ?");
      values.push(body.color);
    }
    if (body.sortOrder !== undefined) {
      fields.push("sortOrder = ?");
      values.push(body.sortOrder);
    }

    if (fields.length) {
      fields.push("updatedAt = ?");
      values.push(now);
      values.push(id);
      db.prepare(`UPDATE roadmap_items SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }

    if (body.taskIds !== undefined) setTaskLinks(id, body.taskIds);

    return buildItem(id);
  });

  // Delete roadmap item
  fastify.delete("/roadmap/:id", async (request, reply) => {
    const { id } = request.params as any;
    const existing = db.prepare("SELECT * FROM roadmap_items WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Roadmap item not found" });

    db.prepare("DELETE FROM roadmap_items WHERE id = ?").run(id);
    return reply.code(204).send();
  });

  // Build a single item with task ids + rollups (used by create/update responses)
  function buildItem(id: string) {
    const row = db.prepare("SELECT * FROM roadmap_items WHERE id = ?").get(id) as any;
    const taskIds = (
      db.prepare("SELECT taskId FROM roadmap_item_tasks WHERE roadmapItemId = ?").all(id) as {
        taskId: string;
      }[]
    ).map((r) => r.taskId);

    const tr = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN t.status IN ('done','approved') THEN 1 ELSE 0 END) AS done
         FROM roadmap_item_tasks rit
         JOIN tasks t ON t.id = rit.taskId
         WHERE rit.roadmapItemId = ?`,
      )
      .get(id) as { total: number; done: number | null };

    let milestoneTasksTotal: number | null = null;
    let milestoneTasksDone: number | null = null;
    if (row.milestoneId) {
      const mr = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status IN ('done','approved') THEN 1 ELSE 0 END) AS done
           FROM tasks WHERE milestoneId = ?`,
        )
        .get(row.milestoneId) as { total: number; done: number | null };
      milestoneTasksTotal = mr.total ?? 0;
      milestoneTasksDone = mr.done ?? 0;
    }

    return {
      ...parseRoadmapRow(row),
      taskIds,
      tasksTotal: tr.total ?? 0,
      tasksDone: tr.done ?? 0,
      milestoneTasksTotal,
      milestoneTasksDone,
    };
  }
};

function parseRoadmapRow(row: any) {
  return {
    ...row,
    dependsOn: JSON.parse(row.dependsOn || "[]"),
  };
}

export default roadmapRoutes;
