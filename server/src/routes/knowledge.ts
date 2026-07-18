import type { FastifyPluginAsync } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { getProjectArtifactsDir } from "../lib/data-dir";
import {
  embed,
  cosineSimilarity,
  vectorFromBlob,
  EMBEDDING_MODEL,
  isEmbeddingsDisabled,
} from "../services/embeddings";
import { embedArtifact } from "../services/artifactEmbedder";
import { embedTask } from "../services/taskEmbedder";
import { embedGraphNode } from "../services/graphNodeEmbedder";
import { isEmbeddableMimeType } from "../lib/chunking";
import { log } from "../lib/logger";
import type {
  KnowledgeSearchHit,
  KnowledgeSearchResponse,
  ArtifactType,
  TaskStatus,
  TaskPriority,
  GraphNodeType,
} from "@vibe-kanban/shared";

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
}

// Raw rows from the embedding-join queries. DB stores enum-ish columns as plain
// strings; we narrow them to the shared union types on the way into the hit.
interface ArtifactEmbeddingJoinRow {
  id: string;
  artifactId: string;
  chunkIdx: number;
  content: string;
  vector: Buffer;
  dim: number;
  filename: string;
  type: ArtifactType;
  description: string | null;
  tags: string | null;
  mimeType: string;
  updatedAt: string;
}

interface TaskEmbeddingJoinRow {
  id: string;
  taskId: string;
  chunkIdx: number;
  content: string;
  vector: Buffer;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  taskNumber: number;
  milestoneId: string | null;
  updatedAt: string;
}

interface GraphNodeEmbeddingJoinRow {
  id: string;
  nodeId: string;
  chunkIdx: number;
  content: string;
  vector: Buffer;
  label: string;
  type: GraphNodeType;
  description: string | null;
  updatedAt: string;
}

interface CountRow {
  n: number;
}

const knowledgeRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.post<{ Params: ProjectParams; Body: SearchBody }>(
    "/projects/:projectId/knowledge/search",
    async (request, reply) => {
      const { projectId } = request.params;
      const { query, k = 10, minScore = 0, types } = request.body ?? {};

      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return reply.code(400).send({ error: "query required" });
      }

      const limit = Math.min(Math.max(parseInt(String(k)) || 10, 1), 50);
      const includeArtifacts = !types || types.includes("artifact");
      const includeTasks = !types || types.includes("task");
      const includeGraphNodes = !types || types.includes("graph_node");

      // Kill-switch: with embeddings disabled, return empty WITHOUT loading the
      // model — never call embed(), never read embedding rows.
      if (isEmbeddingsDisabled()) {
        const empty: KnowledgeSearchResponse = {
          query,
          model: EMBEDDING_MODEL,
          results: [],
          totalChunks: 0,
        };
        return empty;
      }

      const queryVec = await embed(query.trim());
      const scored: KnowledgeSearchHit[] = [];

      if (includeArtifacts) {
        const artifactRows = db
          .prepare(
            `SELECT e.id, e.artifactId, e.chunkIdx, e.content, e.vector, e.dim,
                a.filename, a.type, a.description, a.tags, a.mimeType, a.updatedAt
         FROM artifact_embeddings e
         JOIN project_artifacts a ON a.id = e.artifactId
         WHERE e.projectId = ?`,
          )
          .all(projectId) as ArtifactEmbeddingJoinRow[];

        for (const row of artifactRows) {
          const score = cosineSimilarity(queryVec, vectorFromBlob(row.vector));
          scored.push({
            kind: "artifact",
            id: row.id,
            entityId: row.artifactId,
            chunkIdx: row.chunkIdx,
            content: row.content,
            score,
            artifact: {
              id: row.artifactId,
              filename: row.filename,
              type: row.type,
              description: row.description,
              tags: JSON.parse(row.tags || "[]") as string[],
              mimeType: row.mimeType,
              updatedAt: row.updatedAt,
            },
          });
        }
      }

      if (includeTasks) {
        const taskRows = db
          .prepare(
            `SELECT e.id, e.taskId, e.chunkIdx, e.content, e.vector,
                t.title, t.status, t.priority, t.taskNumber, t.milestoneId, t.updatedAt
         FROM task_embeddings e
         JOIN tasks t ON t.id = e.taskId
         WHERE e.projectId = ?`,
          )
          .all(projectId) as TaskEmbeddingJoinRow[];

        for (const row of taskRows) {
          const score = cosineSimilarity(queryVec, vectorFromBlob(row.vector));
          scored.push({
            kind: "task",
            id: row.id,
            entityId: row.taskId,
            chunkIdx: row.chunkIdx,
            content: row.content,
            score,
            task: {
              id: row.taskId,
              title: row.title,
              status: row.status,
              priority: row.priority,
              taskNumber: row.taskNumber,
              milestoneId: row.milestoneId,
              updatedAt: row.updatedAt,
            },
          });
        }
      }

      if (includeGraphNodes) {
        const nodeRows = db
          .prepare(
            `SELECT e.id, e.nodeId, e.chunkIdx, e.content, e.vector,
                n.label, n.type, n.description, n.updatedAt
         FROM graph_node_embeddings e
         JOIN project_graph_nodes n ON n.id = e.nodeId
         WHERE e.projectId = ? AND ${MIRROR_NODE_EXCLUSION}`,
          )
          .all(projectId) as GraphNodeEmbeddingJoinRow[];

        for (const row of nodeRows) {
          const score = cosineSimilarity(queryVec, vectorFromBlob(row.vector));
          scored.push({
            kind: "graph_node",
            id: row.id,
            entityId: row.nodeId,
            chunkIdx: row.chunkIdx,
            content: row.content,
            score,
            graphNode: {
              id: row.nodeId,
              label: row.label,
              type: row.type,
              description: row.description,
              updatedAt: row.updatedAt,
            },
          });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      const filtered = scored.filter((s) => s.score >= minScore).slice(0, limit);

      const response: KnowledgeSearchResponse = {
        query,
        model: EMBEDDING_MODEL,
        results: filtered,
        totalChunks: scored.length,
      };
      return response;
    },
  );

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
