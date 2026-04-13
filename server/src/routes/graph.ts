import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";

const graphRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // Get full graph (nodes + edges) for a project
  fastify.get("/projects/:projectId/graph", async (request) => {
    const { projectId } = request.params as any;

    const nodes = (db.prepare(
      "SELECT * FROM project_graph_nodes WHERE projectId = ? ORDER BY createdAt ASC"
    ).all(projectId) as any[]).map(parseNodeRow);

    const edges = db.prepare(
      "SELECT * FROM project_graph_edges WHERE projectId = ? ORDER BY createdAt ASC"
    ).all(projectId) as any[];

    return { nodes, edges };
  });

  // Create node
  fastify.post("/projects/:projectId/graph/nodes", async (request) => {
    const { projectId } = request.params as any;
    const { label, type = "concept", description, x, y, metadata = {} } = request.body as any;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO project_graph_nodes (id, projectId, label, type, description, x, y, metadata, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, label, type, description || null, x ?? null, y ?? null, JSON.stringify(metadata), now, now);

    return parseNodeRow(
      db.prepare("SELECT * FROM project_graph_nodes WHERE id = ?").get(id) as any
    );
  });

  // Update node
  fastify.patch("/graph/nodes/:id", async (request, reply) => {
    const { id } = request.params as any;
    const body = request.body as any;

    const existing = db.prepare("SELECT * FROM project_graph_nodes WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Node not found" });

    const fields: string[] = [];
    const values: unknown[] = [];
    const now = new Date().toISOString();

    if (body.label !== undefined) { fields.push("label = ?"); values.push(body.label); }
    if (body.type !== undefined) { fields.push("type = ?"); values.push(body.type); }
    if (body.description !== undefined) { fields.push("description = ?"); values.push(body.description); }
    if (body.x !== undefined) { fields.push("x = ?"); values.push(body.x); }
    if (body.y !== undefined) { fields.push("y = ?"); values.push(body.y); }
    if (body.metadata !== undefined) { fields.push("metadata = ?"); values.push(JSON.stringify(body.metadata)); }

    if (fields.length) {
      fields.push("updatedAt = ?");
      values.push(now);
      values.push(id);
      db.prepare(`UPDATE project_graph_nodes SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }

    return parseNodeRow(
      db.prepare("SELECT * FROM project_graph_nodes WHERE id = ?").get(id) as any
    );
  });

  // Delete node (cascades to edges)
  fastify.delete("/graph/nodes/:id", async (request, reply) => {
    const { id } = request.params as any;
    const existing = db.prepare("SELECT * FROM project_graph_nodes WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Node not found" });

    db.prepare("DELETE FROM project_graph_nodes WHERE id = ?").run(id);
    return reply.code(204).send();
  });

  // Create edge
  fastify.post("/projects/:projectId/graph/edges", async (request, reply) => {
    const { projectId } = request.params as any;
    const { sourceNodeId, targetNodeId, label, type = "related" } = request.body as any;

    if (!sourceNodeId || !targetNodeId) {
      return reply.code(400).send({ error: "sourceNodeId and targetNodeId required" });
    }

    // Verify nodes exist and belong to project
    const source = db.prepare("SELECT id FROM project_graph_nodes WHERE id = ? AND projectId = ?").get(sourceNodeId, projectId);
    const target = db.prepare("SELECT id FROM project_graph_nodes WHERE id = ? AND projectId = ?").get(targetNodeId, projectId);
    if (!source || !target) {
      return reply.code(400).send({ error: "Source or target node not found in this project" });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO project_graph_edges (id, projectId, sourceNodeId, targetNodeId, label, type, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, sourceNodeId, targetNodeId, label || null, type, now);

    return db.prepare("SELECT * FROM project_graph_edges WHERE id = ?").get(id);
  });

  // Delete edge
  fastify.delete("/graph/edges/:id", async (request, reply) => {
    const { id } = request.params as any;
    const existing = db.prepare("SELECT * FROM project_graph_edges WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Edge not found" });

    db.prepare("DELETE FROM project_graph_edges WHERE id = ?").run(id);
    return reply.code(204).send();
  });
};

function parseNodeRow(row: any) {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export default graphRoutes;
