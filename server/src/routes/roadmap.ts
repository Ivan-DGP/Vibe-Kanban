import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";

const roadmapRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // List roadmap items for a project
  fastify.get("/projects/:projectId/roadmap", async (request) => {
    const { projectId } = request.params as any;
    const rows = db
      .prepare(
        "SELECT * FROM roadmap_items WHERE projectId = ? ORDER BY sortOrder ASC, createdAt ASC",
      )
      .all(projectId) as any[];
    return rows.map(parseRoadmapRow);
  });

  // Create roadmap item
  fastify.post("/projects/:projectId/roadmap", async (request) => {
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
    } = request.body as any;
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

    return parseRoadmapRow(db.prepare("SELECT * FROM roadmap_items WHERE id = ?").get(id) as any);
  });

  // Update roadmap item
  fastify.patch("/roadmap/:id", async (request, reply) => {
    const { id } = request.params as any;
    const body = request.body as any;

    const existing = db.prepare("SELECT * FROM roadmap_items WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Roadmap item not found" });

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

    return parseRoadmapRow(db.prepare("SELECT * FROM roadmap_items WHERE id = ?").get(id) as any);
  });

  // Delete roadmap item
  fastify.delete("/roadmap/:id", async (request, reply) => {
    const { id } = request.params as any;
    const existing = db.prepare("SELECT * FROM roadmap_items WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Roadmap item not found" });

    db.prepare("DELETE FROM roadmap_items WHERE id = ?").run(id);
    return reply.code(204).send();
  });
};

function parseRoadmapRow(row: any) {
  return {
    ...row,
    dependsOn: JSON.parse(row.dependsOn || "[]"),
  };
}

export default roadmapRoutes;
