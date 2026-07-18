import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { log } from "../lib/logger";
import { depGraphToKnowledgeWithAI } from "../services/depGraphToKnowledge";
import { getSafeEnv } from "../services/terminalRegistry";

interface ProjectParams {
  projectId: string;
}

const ORIGIN = "dep-graph";

// Draft the architecture layer of the knowledge graph from the dependency graph:
// each subsystem → a suggested "system" node, heavy cross-subsystem imports →
// suggested "depends_on" edges. Idempotent — re-running replaces prior dep-graph
// suggestions. Users confirm/edit them via the existing suggestions flow.
const depGraphKnowledgeRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.post<{ Params: ProjectParams }>(
    "/projects/:projectId/graph/from-dependencies",
    async (request, reply) => {
      const { projectId } = request.params;
      const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as
        | { path: string }
        | undefined;
      if (!project) return reply.code(404).send({ error: "Project not found" });

      let result;
      try {
        result = depGraphToKnowledgeWithAI(project.path, getSafeEnv());
      } catch (e) {
        const err = e as { statusCode?: number; message?: string };
        return reply
          .code(err.statusCode ?? 500)
          .send({ error: err.message ?? "Failed to analyze dependencies" });
      }

      const now = new Date().toISOString();
      const write = db.transaction(() => {
        // Clear prior dep-graph suggestions (edges first — FK-free but keep order sane).
        db.prepare("DELETE FROM project_graph_edges WHERE projectId = ? AND origin = ?").run(
          projectId,
          ORIGIN,
        );
        db.prepare("DELETE FROM project_graph_nodes WHERE projectId = ? AND origin = ?").run(
          projectId,
          ORIGIN,
        );

        const nodeIdByCommunity = new Map<number, string>();
        const insertNode = db.prepare(
          `INSERT INTO project_graph_nodes
             (id, projectId, label, type, description, x, y, metadata, status, origin, createdAt, updatedAt)
           VALUES (?, ?, ?, 'system', ?, NULL, NULL, ?, 'suggested', ?, ?, ?)`,
        );
        for (const c of result.communities) {
          const id = crypto.randomUUID();
          nodeIdByCommunity.set(c.community, id);
          insertNode.run(
            id,
            projectId,
            c.label,
            c.description,
            JSON.stringify({
              community: c.community,
              group: c.group,
              fileCount: c.fileCount,
              files: c.files,
            }),
            ORIGIN,
            now,
            now,
          );
        }

        const insertEdge = db.prepare(
          `INSERT INTO project_graph_edges
             (id, projectId, sourceNodeId, targetNodeId, label, type, status, origin, createdAt)
           VALUES (?, ?, ?, ?, ?, 'depends_on', 'suggested', ?, ?)`,
        );
        let edgeCount = 0;
        for (const e of result.edges) {
          const s = nodeIdByCommunity.get(e.source);
          const t = nodeIdByCommunity.get(e.target);
          if (!s || !t) continue;
          insertEdge.run(crypto.randomUUID(), projectId, s, t, `${e.weight} imports`, ORIGIN, now);
          edgeCount++;
        }
        return { nodes: nodeIdByCommunity.size, edges: edgeCount };
      });

      const counts = write();
      log("info", "server", `Knowledge graph drafted from dependencies for ${projectId}`, {
        ...counts,
        files: result.fileCount,
      });
      return { ...counts, fileCount: result.fileCount };
    },
  );
};

export default depGraphKnowledgeRoutes;
