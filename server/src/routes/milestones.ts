import type { FastifyPluginAsync } from "fastify";
import type { CreateMilestoneInput, UpdateMilestoneInput } from "@vibe-kanban/shared";
import { getDb } from "../db";
import { writeTaskSnapshot } from "../services/snapshot";

const milestoneRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.get("/projects/:projectId/milestones", async (request) => {
    const { projectId } = request.params as any;
    return db
      .prepare("SELECT * FROM milestones WHERE projectId = ? ORDER BY createdAt ASC")
      .all(projectId);
  });

  fastify.post("/projects/:projectId/milestones", async (request) => {
    const { projectId } = request.params as any;
    const { name } = request.body as CreateMilestoneInput;
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();

    db.prepare("INSERT INTO milestones (id, projectId, name, createdAt) VALUES (?, ?, ?, ?)").run(
      id,
      projectId,
      name,
      ts,
    );

    return db.prepare("SELECT * FROM milestones WHERE id = ?").get(id);
  });

  fastify.patch("/milestones/:id", async (request, reply) => {
    const { id } = request.params as any;
    const { name, status, aiInstructions } = request.body as UpdateMilestoneInput;

    const existing = db.prepare("SELECT * FROM milestones WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Milestone not found" });

    const fields: string[] = [];
    const values: any[] = [];

    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (status !== undefined) {
      fields.push("status = ?");
      values.push(status);
    }
    if (aiInstructions !== undefined) {
      fields.push("aiInstructions = ?");
      values.push(aiInstructions);
    }

    if (fields.length) {
      values.push(id);
      db.prepare(`UPDATE milestones SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }

    return db.prepare("SELECT * FROM milestones WHERE id = ?").get(id);
  });

  fastify.delete("/milestones/:id", async (request, reply) => {
    const { id } = request.params as any;
    const existing = db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as any;
    if (!existing) return reply.code(404).send({ error: "Milestone not found" });

    // Tasks get milestoneId = NULL via ON DELETE SET NULL
    db.prepare("DELETE FROM milestones WHERE id = ?").run(id);
    writeTaskSnapshot(existing.projectId);
    return reply.code(204).send();
  });
};

export default milestoneRoutes;
