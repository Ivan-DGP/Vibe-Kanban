import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { embedGraphNodeInBackground } from "../services/graphNodeEmbedder";
import type {
  GraphNode,
  GraphEdge,
  GraphNodeType,
  CreateGraphNodeInput,
  UpdateGraphNodeInput,
  CreateGraphEdgeInput,
} from "@vibe-kanban/shared";

// Raw row from project_graph_nodes. `metadata` is stored as a JSON string.
interface GraphNodeRow {
  id: string;
  projectId: string;
  label: string;
  type: GraphNodeType;
  description: string | null;
  x: number | null;
  y: number | null;
  metadata: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectParams {
  projectId: string;
}
interface IdParams {
  id: string;
}

const graphRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // Get full graph (nodes + edges) for a project
  fastify.get<{ Params: ProjectParams }>("/projects/:projectId/graph", async (request) => {
    const { projectId } = request.params;

    const nodes = (
      db
        .prepare("SELECT * FROM project_graph_nodes WHERE projectId = ? ORDER BY createdAt ASC")
        .all(projectId) as GraphNodeRow[]
    ).map(parseNodeRow);

    const edges = db
      .prepare("SELECT * FROM project_graph_edges WHERE projectId = ? ORDER BY createdAt ASC")
      .all(projectId) as GraphEdge[];

    return { nodes, edges };
  });

  // Create node
  fastify.post<{ Params: ProjectParams; Body: CreateGraphNodeInput }>(
    "/projects/:projectId/graph/nodes",
    async (request) => {
      const { projectId } = request.params;
      const { label, type = "concept", description, x, y, metadata = {} } = request.body ?? {};
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO project_graph_nodes (id, projectId, label, type, description, x, y, metadata, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        projectId,
        label,
        type,
        description || null,
        x ?? null,
        y ?? null,
        JSON.stringify(metadata),
        now,
        now,
      );

      embedGraphNodeInBackground({ projectId, nodeId: id, label, type, description });

      return parseNodeRow(
        db.prepare("SELECT * FROM project_graph_nodes WHERE id = ?").get(id) as GraphNodeRow,
      );
    },
  );

  // Update node
  fastify.patch<{ Params: IdParams; Body: UpdateGraphNodeInput }>(
    "/graph/nodes/:id",
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body ?? {};

      const existing = db.prepare("SELECT * FROM project_graph_nodes WHERE id = ?").get(id);
      if (!existing) return reply.code(404).send({ error: "Node not found" });

      const fields: string[] = [];
      const values: unknown[] = [];
      const now = new Date().toISOString();

      if (body.label !== undefined) {
        fields.push("label = ?");
        values.push(body.label);
      }
      if (body.type !== undefined) {
        fields.push("type = ?");
        values.push(body.type);
      }
      if (body.description !== undefined) {
        fields.push("description = ?");
        values.push(body.description);
      }
      if (body.x !== undefined) {
        fields.push("x = ?");
        values.push(body.x);
      }
      if (body.y !== undefined) {
        fields.push("y = ?");
        values.push(body.y);
      }
      if (body.metadata !== undefined) {
        fields.push("metadata = ?");
        values.push(JSON.stringify(body.metadata));
      }

      if (fields.length) {
        fields.push("updatedAt = ?");
        values.push(now);
        values.push(id);
        db.prepare(`UPDATE project_graph_nodes SET ${fields.join(", ")} WHERE id = ?`).run(
          ...values,
        );
      }

      const updated = db
        .prepare("SELECT * FROM project_graph_nodes WHERE id = ?")
        .get(id) as GraphNodeRow;

      if (body.label !== undefined || body.type !== undefined || body.description !== undefined) {
        embedGraphNodeInBackground({
          projectId: updated.projectId,
          nodeId: id,
          label: updated.label,
          type: updated.type,
          description: updated.description,
        });
      }

      return parseNodeRow(updated);
    },
  );

  // Delete node (cascades to edges)
  fastify.delete<{ Params: IdParams }>("/graph/nodes/:id", async (request, reply) => {
    const { id } = request.params;
    const existing = db.prepare("SELECT * FROM project_graph_nodes WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Node not found" });

    db.prepare("DELETE FROM project_graph_nodes WHERE id = ?").run(id);
    return reply.code(204).send();
  });

  // Create edge
  fastify.post<{ Params: ProjectParams; Body: CreateGraphEdgeInput }>(
    "/projects/:projectId/graph/edges",
    async (request, reply) => {
      const { projectId } = request.params;
      const { sourceNodeId, targetNodeId, label, type = "related" } = request.body ?? {};

      if (!sourceNodeId || !targetNodeId) {
        return reply.code(400).send({ error: "sourceNodeId and targetNodeId required" });
      }

      // Verify nodes exist and belong to project
      const source = db
        .prepare("SELECT id FROM project_graph_nodes WHERE id = ? AND projectId = ?")
        .get(sourceNodeId, projectId);
      const target = db
        .prepare("SELECT id FROM project_graph_nodes WHERE id = ? AND projectId = ?")
        .get(targetNodeId, projectId);
      if (!source || !target) {
        return reply.code(400).send({ error: "Source or target node not found in this project" });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO project_graph_edges (id, projectId, sourceNodeId, targetNodeId, label, type, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, projectId, sourceNodeId, targetNodeId, label || null, type, now);

      return db.prepare("SELECT * FROM project_graph_edges WHERE id = ?").get(id) as GraphEdge;
    },
  );

  // Delete edge
  fastify.delete<{ Params: IdParams }>("/graph/edges/:id", async (request, reply) => {
    const { id } = request.params;
    const existing = db.prepare("SELECT * FROM project_graph_edges WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Edge not found" });

    db.prepare("DELETE FROM project_graph_edges WHERE id = ?").run(id);
    return reply.code(204).send();
  });
};

function parseNodeRow(row: GraphNodeRow): GraphNode {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export default graphRoutes;
