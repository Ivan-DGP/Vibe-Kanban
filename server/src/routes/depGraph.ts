import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { log } from "../lib/logger";
import { generateDepGraph } from "../services/depGraph";
import type { DepGraph } from "@vibe-kanban/shared";

interface ProjectParams {
  projectId: string;
}

// Extraction walks the filesystem, so cache the last result per project and only
// recompute when the client asks (?refresh=true) — same pattern as other
// on-demand analyses.
const cache = new Map<string, DepGraph>();

const depGraphRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.get<{ Params: ProjectParams; Querystring: { refresh?: string } }>(
    "/projects/:projectId/dep-graph",
    async (request, reply) => {
      const { projectId } = request.params;
      const refresh = request.query.refresh === "true" || request.query.refresh === "1";

      if (!refresh && cache.has(projectId)) return cache.get(projectId);

      const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as
        | { path: string }
        | undefined;
      if (!project) return reply.code(404).send({ error: "Project not found" });

      try {
        const graph = generateDepGraph(project.path);
        cache.set(projectId, graph);
        log("info", "server", `Dependency graph generated for ${projectId}`, {
          files: graph.fileCount,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        });
        return graph;
      } catch (e) {
        const err = e as { statusCode?: number; message?: string };
        const code = err.statusCode ?? 500;
        log("warn", "server", `Dependency graph failed for ${projectId}: ${err.message}`);
        return reply.code(code).send({ error: err.message ?? "Failed to build dependency graph" });
      }
    },
  );
};

export default depGraphRoutes;
