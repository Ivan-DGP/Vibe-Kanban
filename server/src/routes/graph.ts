import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { embedGraphNodeInBackground } from "../services/graphNodeEmbedder";
import { slugify } from "../lib/wikilinks";
import type {
  GraphNode,
  GraphEdge,
  GraphNodeType,
  GraphEdgeType,
  GraphStatus,
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
  status: GraphNode["status"];
  origin: string | null;
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

  // Idempotent node upsert keyed on (projectId, slug(label), type) so repeated
  // captures of the same concept don't create duplicates. Returns the existing
  // node unchanged on a slug match (never downgrades a confirmed node), else
  // inserts a new one. `created` reports which path was taken.
  function upsertNode(
    input: CreateGraphNodeInput & { projectId: string },
  ): { node: GraphNode; created: boolean } {
    const {
      projectId,
      label,
      type = "concept",
      description,
      x,
      y,
      metadata = {},
      status = "confirmed",
      origin,
    } = input;

    const targetSlug = slugify(label);
    const candidates = db
      .prepare("SELECT * FROM project_graph_nodes WHERE projectId = ? AND type = ?")
      .all(projectId, type) as GraphNodeRow[];
    const match = candidates.find((c) => slugify(c.label) === targetSlug);
    if (match) return { node: parseNodeRow(match), created: false };

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO project_graph_nodes (id, projectId, label, type, description, x, y, metadata, status, origin, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      label,
      type,
      description || null,
      x ?? null,
      y ?? null,
      JSON.stringify(metadata),
      status,
      origin ?? null,
      now,
      now,
    );

    embedGraphNodeInBackground({ projectId, nodeId: id, label, type, description });

    return {
      node: parseNodeRow(
        db.prepare("SELECT * FROM project_graph_nodes WHERE id = ?").get(id) as GraphNodeRow,
      ),
      created: true,
    };
  }

  // Create node (idempotent — see upsertNode)
  fastify.post<{ Params: ProjectParams; Body: CreateGraphNodeInput }>(
    "/projects/:projectId/graph/nodes",
    async (request) => {
      const { projectId } = request.params;
      return upsertNode({ projectId, ...(request.body ?? ({} as CreateGraphNodeInput)) }).node;
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
      const {
        sourceNodeId,
        targetNodeId,
        label,
        type = "related",
        status = "confirmed",
        origin,
      } = request.body ?? {};

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
        `INSERT INTO project_graph_edges (id, projectId, sourceNodeId, targetNodeId, label, type, status, origin, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, projectId, sourceNodeId, targetNodeId, label || null, type, status, origin ?? null, now);

      return db.prepare("SELECT * FROM project_graph_edges WHERE id = ?").get(id) as GraphEdge;
    },
  );

  // Batch upsert: nodes (by slug) + edges (endpoints resolved by label, missing
  // nodes auto-created as 'suggested'). One call per capture. Edges are deduped
  // on (projectId, source, target, type). Defaults to 'suggested' status since
  // this is the AI-write path; callers may override per node/edge.
  fastify.post<{
    Params: ProjectParams;
    Body: {
      nodes?: (CreateGraphNodeInput & { label: string })[];
      edges?: {
        source: string;
        target: string;
        type?: GraphEdgeType;
        label?: string;
        status?: GraphStatus;
        origin?: string;
      }[];
    };
  }>("/projects/:projectId/graph/batch", async (request) => {
    const { projectId } = request.params;
    const { nodes = [], edges = [] } = request.body ?? {};

    const resultNodes: GraphNode[] = [];
    const resultEdges: GraphEdge[] = [];
    let nodesCreated = 0;
    let edgesCreated = 0;
    const bySlug = new Map<string, GraphNode>();

    // 1. Upsert explicitly listed nodes.
    for (const n of nodes) {
      const { node, created } = upsertNode({ projectId, ...n, status: n.status ?? "suggested" });
      if (created) nodesCreated++;
      resultNodes.push(node);
      bySlug.set(slugify(node.label), node);
    }

    // Resolve an edge endpoint by label, auto-creating a suggested node if absent.
    const resolve = (label: string, origin?: string): GraphNode => {
      const slug = slugify(label);
      const cached = bySlug.get(slug);
      if (cached) return cached;
      const { node, created } = upsertNode({ projectId, label, status: "suggested", origin });
      if (created) {
        nodesCreated++;
        resultNodes.push(node);
      }
      bySlug.set(slug, node);
      return node;
    };

    // 2. Insert edges, deduping on (source, target, type).
    for (const e of edges) {
      const src = resolve(e.source, e.origin);
      const tgt = resolve(e.target, e.origin);
      const type = e.type ?? "related";
      const existing = db
        .prepare(
          "SELECT * FROM project_graph_edges WHERE projectId = ? AND sourceNodeId = ? AND targetNodeId = ? AND type = ?",
        )
        .get(projectId, src.id, tgt.id, type) as GraphEdge | undefined;
      if (existing) {
        resultEdges.push(existing);
        continue;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO project_graph_edges (id, projectId, sourceNodeId, targetNodeId, label, type, status, origin, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, projectId, src.id, tgt.id, e.label || null, type, e.status ?? "suggested", e.origin ?? null, now);
      edgesCreated++;
      resultEdges.push(
        db.prepare("SELECT * FROM project_graph_edges WHERE id = ?").get(id) as GraphEdge,
      );
    }

    return { nodes: resultNodes, edges: resultEdges, nodesCreated, edgesCreated };
  });

  // Delete edge
  fastify.delete<{ Params: IdParams }>("/graph/edges/:id", async (request, reply) => {
    const { id } = request.params;
    const existing = db.prepare("SELECT * FROM project_graph_edges WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Edge not found" });

    db.prepare("DELETE FROM project_graph_edges WHERE id = ?").run(id);
    return reply.code(204).send();
  });

  // Confirm a suggested node (promote to 'confirmed'). Reject = DELETE.
  fastify.post<{ Params: IdParams }>("/graph/nodes/:id/confirm", async (request, reply) => {
    const { id } = request.params;
    const existing = db.prepare("SELECT id FROM project_graph_nodes WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Node not found" });

    db.prepare("UPDATE project_graph_nodes SET status = 'confirmed', updatedAt = ? WHERE id = ?").run(
      new Date().toISOString(),
      id,
    );
    return parseNodeRow(
      db.prepare("SELECT * FROM project_graph_nodes WHERE id = ?").get(id) as GraphNodeRow,
    );
  });

  // Confirm a suggested edge.
  fastify.post<{ Params: IdParams }>("/graph/edges/:id/confirm", async (request, reply) => {
    const { id } = request.params;
    const existing = db.prepare("SELECT id FROM project_graph_edges WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Edge not found" });

    db.prepare("UPDATE project_graph_edges SET status = 'confirmed' WHERE id = ?").run(id);
    return db.prepare("SELECT * FROM project_graph_edges WHERE id = ?").get(id) as GraphEdge;
  });

  // Bulk-confirm nodes and/or edges scoped to a project.
  fastify.post<{ Params: ProjectParams; Body: { nodeIds?: string[]; edgeIds?: string[] } }>(
    "/projects/:projectId/graph/confirm",
    async (request) => {
      const { projectId } = request.params;
      const { nodeIds = [], edgeIds = [] } = request.body ?? {};
      const now = new Date().toISOString();

      let nodesConfirmed = 0;
      let edgesConfirmed = 0;
      db.transaction(() => {
        const nodeStmt = db.prepare(
          "UPDATE project_graph_nodes SET status = 'confirmed', updatedAt = ? WHERE id = ? AND projectId = ?",
        );
        for (const id of nodeIds) nodesConfirmed += nodeStmt.run(now, id, projectId).changes;
        const edgeStmt = db.prepare(
          "UPDATE project_graph_edges SET status = 'confirmed' WHERE id = ? AND projectId = ?",
        );
        for (const id of edgeIds) edgesConfirmed += edgeStmt.run(id, projectId).changes;
      })();

      return { nodesConfirmed, edgesConfirmed };
    },
  );
};

function parseNodeRow(row: GraphNodeRow): GraphNode {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export default graphRoutes;
