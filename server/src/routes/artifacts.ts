import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { embedArtifactInBackground, clearArtifactEmbeddings } from "../services/artifactEmbedder";
import { removeArtifactMirror, getArtifactLinks } from "../services/wikilinks";
import { isEmbeddableMimeType } from "../lib/chunking";
import {
  ArtifactError,
  ArtifactRow,
  artifactFilePath,
  createArtifact,
  getMimeType,
  inferArtifactType,
  parseArtifactRow,
  updateArtifact,
} from "../services/artifactService";
import fs from "node:fs";
import type { ArtifactType } from "@vibe-kanban/shared";

interface ProjectParams {
  projectId: string;
}
interface ArtifactParams {
  projectId: string;
  id: string;
}
interface ListQuery {
  type?: string;
  search?: string;
  limit?: string;
  offset?: string;
}
interface CreateBody {
  filename?: string;
  type?: ArtifactType;
  description?: string;
  tags?: string[];
  content?: string;
}
interface PatchBody {
  filename?: string;
  type?: ArtifactType;
  description?: string | null;
  tags?: string[];
  content?: string;
}

const artifactRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // List artifacts for a project
  fastify.get<{ Params: ProjectParams; Querystring: ListQuery }>(
    "/projects/:projectId/artifacts",
    async (request) => {
      const { projectId } = request.params;
      const { type, search, limit = "50", offset = "0" } = request.query;

      let sql = "SELECT * FROM project_artifacts WHERE projectId = ?";
      const bindings: unknown[] = [projectId];

      if (type) {
        sql += " AND type = ?";
        bindings.push(type);
      }
      if (search) {
        sql += " AND (filename LIKE ? OR description LIKE ?)";
        bindings.push(`%${search}%`, `%${search}%`);
      }

      const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as total");
      const total = (
        db.prepare(countSql).get(...(bindings as [unknown, ...unknown[]])) as { total: number }
      ).total;

      const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
      const offsetNum = Math.max(parseInt(offset) || 0, 0);
      sql += " ORDER BY updatedAt DESC LIMIT ? OFFSET ?";
      bindings.push(limitNum, offsetNum);

      const items = (
        db.prepare(sql).all(...(bindings as [unknown, ...unknown[]])) as ArtifactRow[]
      ).map(parseArtifactRow);

      return { items, total, hasMore: offsetNum + items.length < total };
    },
  );

  // Get single artifact metadata
  fastify.get<{ Params: ArtifactParams }>(
    "/projects/:projectId/artifacts/:id",
    async (request, reply) => {
      const { projectId, id } = request.params;
      const row = db
        .prepare("SELECT * FROM project_artifacts WHERE id = ? AND projectId = ?")
        .get(id, projectId) as ArtifactRow | undefined;
      if (!row) return reply.code(404).send({ error: "Artifact not found" });
      return parseArtifactRow(row);
    },
  );

  // Get artifact content (file bytes or text)
  fastify.get<{ Params: ArtifactParams }>(
    "/projects/:projectId/artifacts/:id/content",
    async (request, reply) => {
      const { projectId, id } = request.params;
      const row = db
        .prepare("SELECT * FROM project_artifacts WHERE id = ? AND projectId = ?")
        .get(id, projectId) as ArtifactRow | undefined;
      if (!row) return reply.code(404).send({ error: "Artifact not found" });

      const filePath = artifactFilePath(projectId, row.id, row.filename);
      if (!fs.existsSync(filePath)) {
        return reply.code(404).send({ error: "Artifact file not found on disk" });
      }

      const isText = row.mimeType.startsWith("text/") || row.mimeType === "application/json";
      if (isText) {
        return { content: fs.readFileSync(filePath, "utf-8"), encoding: "utf-8" };
      }
      return { content: fs.readFileSync(filePath).toString("base64"), encoding: "base64" };
    },
  );

  // Create artifact
  fastify.post<{ Params: ProjectParams; Body: CreateBody }>(
    "/projects/:projectId/artifacts",
    async (request, reply) => {
      const { projectId } = request.params;
      const { filename, type, description, tags, content } = request.body ?? {};

      try {
        return createArtifact({
          projectId,
          filename: filename ?? "",
          type,
          description,
          tags,
          content,
        });
      } catch (e) {
        if (e instanceof ArtifactError) return reply.code(e.statusCode).send({ error: e.message });
        throw e;
      }
    },
  );

  // Get an artifact's wikilinks: outbound links + inbound backlinks with counts
  fastify.get<{ Params: ArtifactParams }>(
    "/projects/:projectId/artifacts/:id/links",
    async (request, reply) => {
      const { projectId, id } = request.params;
      const row = db
        .prepare("SELECT id FROM project_artifacts WHERE id = ? AND projectId = ?")
        .get(id, projectId);
      if (!row) return reply.code(404).send({ error: "Artifact not found" });
      return getArtifactLinks(db, projectId, id);
    },
  );

  // Update artifact metadata and/or content
  fastify.patch<{ Params: ArtifactParams; Body: PatchBody }>(
    "/projects/:projectId/artifacts/:id",
    async (request, reply) => {
      const { projectId, id } = request.params;
      const body = request.body ?? {};

      try {
        const updated = updateArtifact({ projectId, id, ...body });
        if (!updated) return reply.code(404).send({ error: "Artifact not found" });
        return updated;
      } catch (e) {
        if (e instanceof ArtifactError) return reply.code(e.statusCode).send({ error: e.message });
        throw e;
      }
    },
  );

  // Upload artifact (multipart file)
  fastify.post<{ Params: ProjectParams }>(
    "/projects/:projectId/artifacts/upload",
    async (request, reply) => {
      const { projectId } = request.params;

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "No file uploaded" });

      const chunks: Buffer[] = [];
      for await (const chunk of file.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      if (file.file.truncated) {
        return reply.code(413).send({ error: "File too large (max 10MB)" });
      }

      const originalFilename = file.filename;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const mimeType = file.mimetype || getMimeType(originalFilename);
      const type = inferArtifactType(mimeType);

      // Write to disk (path-guarded against traversal).
      const filePath = artifactFilePath(projectId, id, originalFilename);
      fs.writeFileSync(filePath, buffer);

      db.prepare(
        `INSERT INTO project_artifacts (id, projectId, filename, type, description, tags, sizeBytes, mimeType, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, projectId, originalFilename, type, null, "[]", buffer.length, mimeType, now, now);

      if (isEmbeddableMimeType(mimeType)) {
        embedArtifactInBackground({
          projectId,
          artifactId: id,
          content: buffer.toString("utf-8"),
          mimeType,
        });
      }

      return parseArtifactRow(
        db.prepare("SELECT * FROM project_artifacts WHERE id = ?").get(id) as ArtifactRow,
      );
    },
  );

  // Delete artifact
  fastify.delete<{ Params: ArtifactParams }>(
    "/projects/:projectId/artifacts/:id",
    async (request, reply) => {
      const { projectId, id } = request.params;
      const existing = db
        .prepare("SELECT * FROM project_artifacts WHERE id = ? AND projectId = ?")
        .get(id, projectId) as ArtifactRow | undefined;
      if (!existing) return reply.code(404).send({ error: "Artifact not found" });

      // Delete file from disk (path-guarded against traversal).
      const filePath = artifactFilePath(projectId, id, existing.filename);
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath);
      }

      // Invalidate the artifact's embeddings so stale vectors never influence
      // knowledge ranking (also covered by ON DELETE CASCADE; explicit for clarity).
      clearArtifactEmbeddings(id);
      // Drop the mirror node BEFORE the artifact row: the node's ON DELETE CASCADE
      // clears every inbound/outbound wikilink edge so none dangle.
      removeArtifactMirror(db, projectId, id);
      db.prepare("DELETE FROM project_artifacts WHERE id = ?").run(id);
      return reply.code(204).send();
    },
  );
};

export default artifactRoutes;
