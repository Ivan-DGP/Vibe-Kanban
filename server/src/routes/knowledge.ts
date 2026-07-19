import type { FastifyPluginAsync } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { getProjectArtifactsDir } from "../lib/data-dir";
import { EMBEDDING_MODEL } from "../services/embeddings";
import { retrieveKnowledge, type KnowledgeHit } from "../services/knowledgeRetrieval";
import { embedArtifact } from "../services/artifactEmbedder";
import { embedTask } from "../services/taskEmbedder";
import { embedGraphNode } from "../services/graphNodeEmbedder";
import { isEmbeddableMimeType } from "../lib/chunking";
import { log } from "../lib/logger";
import type { KnowledgeSearchHit, KnowledgeSearchResponse } from "@vibe-kanban/shared";

interface ProjectParams {
  projectId: string;
}

// Artifact-mirror graph nodes (metadata.kind === 'artifact') are stand-ins for
// artifacts, which are already embedded on their own. Indexing them too would
// pollute search with filename-only near-duplicates, so they are excluded from
// knowledge indexing, stats, and search. Reference the project_graph_nodes row
// as `n` where this fragment is used. `metadata` is unqualified here because
// graph_node_embeddings has no such column (no ambiguity in the join queries).
const MIRROR_NODE_EXCLUSION = "COALESCE(json_extract(n.metadata, '$.kind'), '') != 'artifact'";

interface SearchBody {
  query?: string;
  k?: number;
  minScore?: number;
  types?: ("artifact" | "task" | "graph_node")[];
  // Opt-in hybrid refinements (default off). See services/knowledgeRetrieval.
  recencyHalfLifeDays?: number;
  expandNeighbors?: boolean;
  perEntityCap?: number;
}

interface CountRow {
  n: number;
}

/** Project a core retrieval hit onto the public KnowledgeSearchHit wire shape.
 * The core's per-kind payloads already match the wire sub-objects 1:1. */
function toSearchHit(hit: KnowledgeHit): KnowledgeSearchHit {
  const base = {
    id: hit.embId,
    entityId: hit.entityId,
    chunkIdx: hit.chunkIdx,
    content: hit.content,
    score: hit.score,
    ...(hit.neighborContext !== undefined ? { neighborContext: hit.neighborContext } : {}),
    ...(hit.project ? { project: hit.project } : {}),
  };
  if (hit.kind === "artifact") return { kind: "artifact", ...base, artifact: hit.artifact! };
  if (hit.kind === "task") return { kind: "task", ...base, task: hit.task! };
  return { kind: "graph_node", ...base, graphNode: hit.graphNode! };
}

const knowledgeRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.post<{ Params: ProjectParams; Body: SearchBody }>(
    "/projects/:projectId/knowledge/search",
    async (request, reply) => {
      const { projectId } = request.params;
      const {
        query,
        k = 10,
        minScore = 0,
        types,
        recencyHalfLifeDays,
        expandNeighbors,
        perEntityCap,
      } = request.body ?? {};

      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return reply.code(400).send({ error: "query required" });
      }

      // Hybrid retrieval: vector cosine + FTS5 lexical, fused via RRF. The core
      // honors the VK_DISABLE_EMBEDDINGS kill-switch (empty, no model load).
      // NOTE: minScore now floors the fused RRF score (default 0 keeps all), not
      // raw cosine — a deliberate scale change vs the prior vector-only endpoint.
      const result = await retrieveKnowledge({
        projectId,
        query,
        k,
        minScore,
        types,
        recencyHalfLifeDays,
        expandNeighbors,
        perEntityCap,
      });

      const response: KnowledgeSearchResponse = {
        query,
        model: EMBEDDING_MODEL,
        results: result.hits.map(toSearchHit),
        totalChunks: result.totalCandidates,
      };
      return response;
    },
  );

  // Cross-project search: same hybrid pipeline with projectId omitted, so it
  // ranks across ALL projects. Each hit carries its source `project`. Powers the
  // cross-project specialist agent.
  fastify.post<{ Body: SearchBody }>("/cross-project/knowledge/search", async (request, reply) => {
    const {
      query,
      k = 10,
      minScore = 0,
      types,
      recencyHalfLifeDays,
      expandNeighbors,
      perEntityCap,
    } = request.body ?? {};

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return reply.code(400).send({ error: "query required" });
    }

    const result = await retrieveKnowledge({
      query,
      k,
      minScore,
      types,
      recencyHalfLifeDays,
      expandNeighbors,
      perEntityCap,
    });

    const response: KnowledgeSearchResponse = {
      query,
      model: EMBEDDING_MODEL,
      results: result.hits.map(toSearchHit),
      totalChunks: result.totalCandidates,
    };
    return response;
  });

  fastify.get<{ Params: ProjectParams }>(
    "/projects/:projectId/knowledge/stats",
    async (request) => {
      const { projectId } = request.params;

      const count = (sql: string, ...binds: unknown[]): number =>
        (db.prepare(sql).get(...(binds as [unknown, ...unknown[]])) as CountRow).n;

      const artifactCount = count(
        "SELECT COUNT(*) as n FROM project_artifacts WHERE projectId = ?",
        projectId,
      );
      const embeddedArtifacts = count(
        "SELECT COUNT(DISTINCT artifactId) as n FROM artifact_embeddings WHERE projectId = ?",
        projectId,
      );
      const chunkCount = count(
        "SELECT COUNT(*) as n FROM artifact_embeddings WHERE projectId = ?",
        projectId,
      );
      const taskCount = count(
        "SELECT COUNT(*) as n FROM tasks WHERE projectId = ? AND status != 'archived'",
        projectId,
      );
      const embeddedTasks = count(
        "SELECT COUNT(DISTINCT taskId) as n FROM task_embeddings WHERE projectId = ?",
        projectId,
      );
      const taskChunkCount = count(
        "SELECT COUNT(*) as n FROM task_embeddings WHERE projectId = ?",
        projectId,
      );
      const graphNodeCount = count(
        `SELECT COUNT(*) as n FROM project_graph_nodes n WHERE n.projectId = ? AND ${MIRROR_NODE_EXCLUSION}`,
        projectId,
      );
      const embeddedGraphNodes = count(
        `SELECT COUNT(DISTINCT e.nodeId) as n FROM graph_node_embeddings e
         JOIN project_graph_nodes n ON n.id = e.nodeId
         WHERE e.projectId = ? AND ${MIRROR_NODE_EXCLUSION}`,
        projectId,
      );
      const graphNodeChunkCount = count(
        `SELECT COUNT(*) as n FROM graph_node_embeddings e
         JOIN project_graph_nodes n ON n.id = e.nodeId
         WHERE e.projectId = ? AND ${MIRROR_NODE_EXCLUSION}`,
        projectId,
      );

      return {
        model: EMBEDDING_MODEL,
        artifactCount,
        embeddedArtifacts,
        chunkCount,
        pending: Math.max(0, artifactCount - embeddedArtifacts),
        taskCount,
        embeddedTasks,
        taskChunkCount,
        pendingTasks: Math.max(0, taskCount - embeddedTasks),
        graphNodeCount,
        embeddedGraphNodes,
        graphNodeChunkCount,
        pendingGraphNodes: Math.max(0, graphNodeCount - embeddedGraphNodes),
      };
    },
  );

  fastify.post<{ Params: ProjectParams; Body: { force?: boolean } }>(
    "/projects/:projectId/knowledge/backfill",
    async (request, reply) => {
      const { projectId } = request.params;
      const { force = false } = request.body ?? {};

      const artifacts = db
        .prepare("SELECT id, filename, mimeType FROM project_artifacts WHERE projectId = ?")
        .all(projectId) as { id: string; filename: string; mimeType: string }[];

      const tasks = db
        .prepare(
          "SELECT id, title, description, prompt, status FROM tasks WHERE projectId = ? AND status != 'archived'",
        )
        .all(projectId) as {
        id: string;
        title: string;
        description: string | null;
        prompt: string | null;
        status: string;
      }[];

      const graphNodes = db
        .prepare(
          `SELECT n.id, n.label, n.type, n.description FROM project_graph_nodes n
           WHERE n.projectId = ? AND ${MIRROR_NODE_EXCLUSION}`,
        )
        .all(projectId) as {
        id: string;
        label: string;
        type: string | null;
        description: string | null;
      }[];

      if (artifacts.length === 0 && tasks.length === 0 && graphNodes.length === 0) {
        return { embedded: 0, skipped: 0, errors: 0, total: 0 };
      }

      const artifactsDir = getProjectArtifactsDir(projectId);
      let embedded = 0;
      let skipped = 0;
      let errors = 0;

      void (async () => {
        for (const a of artifacts) {
          if (!isEmbeddableMimeType(a.mimeType)) {
            skipped++;
            continue;
          }
          if (!force) {
            const has = (
              db
                .prepare("SELECT COUNT(*) as n FROM artifact_embeddings WHERE artifactId = ?")
                .get(a.id) as CountRow
            ).n;
            if (has > 0) {
              skipped++;
              continue;
            }
          }
          try {
            const ext = path.extname(a.filename) || ".md";
            const filePath = path.join(artifactsDir, a.id + ext);
            if (!fs.existsSync(filePath)) {
              errors++;
              continue;
            }
            const content = fs.readFileSync(filePath, "utf-8");
            await embedArtifact({ projectId, artifactId: a.id, content, mimeType: a.mimeType });
            embedded++;
          } catch (err) {
            log(
              "error",
              "server",
              `Backfill failed for artifact ${a.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
            errors++;
          }
        }

        for (const t of tasks) {
          if (!force) {
            const has = (
              db
                .prepare("SELECT COUNT(*) as n FROM task_embeddings WHERE taskId = ?")
                .get(t.id) as CountRow
            ).n;
            if (has > 0) {
              skipped++;
              continue;
            }
          }
          try {
            await embedTask({
              projectId,
              taskId: t.id,
              title: t.title,
              description: t.description,
              prompt: t.prompt,
              status: t.status,
            });
            embedded++;
          } catch (err) {
            log(
              "error",
              "server",
              `Backfill failed for task ${t.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
            errors++;
          }
        }

        for (const n of graphNodes) {
          if (!force) {
            const has = (
              db
                .prepare("SELECT COUNT(*) as n FROM graph_node_embeddings WHERE nodeId = ?")
                .get(n.id) as CountRow
            ).n;
            if (has > 0) {
              skipped++;
              continue;
            }
          }
          try {
            await embedGraphNode({
              projectId,
              nodeId: n.id,
              label: n.label,
              type: n.type,
              description: n.description,
            });
            embedded++;
          } catch (err) {
            log(
              "error",
              "server",
              `Backfill failed for graph node ${n.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
            errors++;
          }
        }

        log(
          "info",
          "server",
          `Backfill done for project ${projectId}: embedded=${embedded} skipped=${skipped} errors=${errors}`,
        );
      })();

      return reply.send({
        started: true,
        total: artifacts.length + tasks.length + graphNodes.length,
      });
    },
  );
};

export default knowledgeRoutes;
