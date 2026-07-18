import type { FastifyPluginAsync } from "fastify";
import path from "node:path";
import { getDb } from "../db";
import { generateDepGraph } from "../services/depGraph";

interface ProjectParams {
  projectId: string;
}

interface ImpactBody {
  files: string[];
}

export interface ImpactResult {
  files: string[];
  directDependents: number;
  transitiveDependents: number;
  top: { file: string; dependents: number }[];
}

/** Repo-relative id; absolutize under project.path when possible. */
function toRepoRel(file: string, projectPath: string): string {
  const absProject = path.resolve(projectPath);
  if (path.isAbsolute(file)) {
    const rel = path.relative(absProject, path.resolve(file));
    if (rel.startsWith("..") || path.isAbsolute(rel)) return file.split(path.sep).join("/");
    return rel.split(path.sep).join("/");
  }
  return file.replace(/\\/g, "/");
}

const depGraphImpactRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.post<{ Params: ProjectParams; Body: ImpactBody }>(
    "/projects/:projectId/impact",
    async (request, reply) => {
      const { projectId } = request.params;
      const input = Array.isArray(request.body?.files) ? request.body.files : [];

      const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as
        | { path: string }
        | undefined;
      if (!project) return reply.code(404).send({ error: "Project not found" });

      const graph = generateDepGraph(project.path);
      const nodeIds = new Set(graph.nodes.map((n) => n.id));

      // Reverse adjacency: target (imported) → sources (importers)
      const reverse = new Map<string, string[]>();
      for (const e of graph.edges) {
        const list = reverse.get(e.target);
        if (list) list.push(e.source);
        else reverse.set(e.target, [e.source]);
      }

      const seeds: string[] = [];
      const seedSet = new Set<string>();
      for (const f of input) {
        if (typeof f !== "string") continue;
        const id = toRepoRel(f, project.path);
        if (!nodeIds.has(id) || seedSet.has(id)) continue;
        seedSet.add(id);
        seeds.push(id);
      }

      // Immediate importers of the input set (excluding seeds)
      const direct = new Set<string>();
      for (const s of seeds) {
        for (const imp of reverse.get(s) ?? []) {
          if (!seedSet.has(imp)) direct.add(imp);
        }
      }

      // BFS over reverse edges → all transitive dependents
      const reached = new Set<string>();
      const queue = [...seeds];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const imp of reverse.get(cur) ?? []) {
          if (seedSet.has(imp) || reached.has(imp)) continue;
          reached.add(imp);
          queue.push(imp);
        }
      }

      const top = [...reached]
        .map((file) => ({ file, dependents: reverse.get(file)?.length ?? 0 }))
        .sort((a, b) => b.dependents - a.dependents || a.file.localeCompare(b.file))
        .slice(0, 10);

      const result: ImpactResult = {
        files: seeds,
        directDependents: direct.size,
        transitiveDependents: reached.size,
        top,
      };
      return result;
    },
  );
};

export default depGraphImpactRoutes;
