import type { FastifyPluginAsync } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { getProjectArtifactsDir } from "../lib/data-dir";
import { embed, cosineSimilarity, vectorFromBlob, EMBEDDING_MODEL } from "../services/embeddings";
import { embedArtifact } from "../services/artifactEmbedder";
import { isEmbeddableMimeType } from "../lib/chunking";
import { log } from "../lib/logger";

const knowledgeRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.post("/projects/:projectId/knowledge/search", async (request, reply) => {
    const { projectId } = request.params as any;
    const { query, k = 10, minScore = 0 } = request.body as { query?: string; k?: number; minScore?: number };

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return reply.code(400).send({ error: "query required" });
    }

    const limit = Math.min(Math.max(parseInt(String(k)) || 10, 1), 50);
    const queryVec = await embed(query.trim());

    const rows = db.prepare(
      `SELECT e.id, e.artifactId, e.chunkIdx, e.content, e.vector, e.dim,
              a.filename, a.type, a.description, a.tags, a.mimeType, a.updatedAt
       FROM artifact_embeddings e
       JOIN project_artifacts a ON a.id = e.artifactId
       WHERE e.projectId = ?`,
    ).all(projectId) as any[];

    const scored = rows.map((row) => {
      const vec = vectorFromBlob(row.vector);
      const score = cosineSimilarity(queryVec, vec);
      return {
        id: row.id,
        artifactId: row.artifactId,
        chunkIdx: row.chunkIdx,
        content: row.content,
        score,
        artifact: {
          id: row.artifactId,
          filename: row.filename,
          type: row.type,
          description: row.description,
          tags: JSON.parse(row.tags || "[]"),
          mimeType: row.mimeType,
          updatedAt: row.updatedAt,
        },
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const filtered = scored.filter((s) => s.score >= minScore).slice(0, limit);

    return { query, model: EMBEDDING_MODEL, results: filtered, totalChunks: rows.length };
  });

  fastify.get("/projects/:projectId/knowledge/stats", async (request) => {
    const { projectId } = request.params as any;

    const artifactCount = (db.prepare(
      "SELECT COUNT(*) as n FROM project_artifacts WHERE projectId = ?",
    ).get(projectId) as any).n as number;

    const embeddedArtifacts = (db.prepare(
      "SELECT COUNT(DISTINCT artifactId) as n FROM artifact_embeddings WHERE projectId = ?",
    ).get(projectId) as any).n as number;

    const chunkCount = (db.prepare(
      "SELECT COUNT(*) as n FROM artifact_embeddings WHERE projectId = ?",
    ).get(projectId) as any).n as number;

    return {
      model: EMBEDDING_MODEL,
      artifactCount,
      embeddedArtifacts,
      chunkCount,
      pending: Math.max(0, artifactCount - embeddedArtifacts),
    };
  });

  fastify.post("/projects/:projectId/knowledge/backfill", async (request, reply) => {
    const { projectId } = request.params as any;
    const { force = false } = (request.body || {}) as { force?: boolean };

    const artifacts = db.prepare(
      "SELECT id, filename, mimeType FROM project_artifacts WHERE projectId = ?",
    ).all(projectId) as any[];

    if (artifacts.length === 0) {
      return { embedded: 0, skipped: 0, errors: 0 };
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
          const has = (db.prepare(
            "SELECT COUNT(*) as n FROM artifact_embeddings WHERE artifactId = ?",
          ).get(a.id) as any).n as number;
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
        } catch (err: any) {
          log("error", "server", `Backfill failed for artifact ${a.id}: ${err?.message ?? err}`);
          errors++;
        }
      }
      log("info", "server", `Backfill done for project ${projectId}: embedded=${embedded} skipped=${skipped} errors=${errors}`);
    })();

    return reply.send({ started: true, total: artifacts.length });
  });
};

export default knowledgeRoutes;
