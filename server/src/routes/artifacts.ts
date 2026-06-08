import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { getProjectArtifactsDir } from "../lib/data-dir";
import { resolveWithin } from "../lib/path-safety";
import { embedArtifactInBackground, clearArtifactEmbeddings } from "../services/artifactEmbedder";
import {
  syncArtifactWikilinks,
  reresolvePendingForArtifact,
  removeArtifactMirror,
  getArtifactLinks,
} from "../services/wikilinks";
import { isEmbeddableMimeType } from "../lib/chunking";
import fs from "node:fs";
import path from "node:path";
import type { Artifact, ArtifactType } from "@vibe-kanban/shared";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Raw row shape from project_artifacts. `tags` is stored as a JSON string.
interface ArtifactRow {
  id: string;
  projectId: string;
  filename: string;
  type: ArtifactType;
  description: string | null;
  tags: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
}

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

/**
 * Resolve the on-disk path for an artifact's stored file, guaranteeing it stays
 * within the project's artifacts dir even after symlink resolution. The leaf is
 * always `<uuid><ext>`; resolveWithin is defense-in-depth against any traversal
 * sneaking in through the derived extension.
 */
function artifactFilePath(projectId: string, id: string, filename: string): string {
  const artifactsDir = getProjectArtifactsDir(projectId);
  return resolveWithin(artifactsDir, id + getExtension(filename));
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
      const {
        filename,
        type = "document",
        description,
        tags = [],
        content = "",
      } = request.body ?? {};

      if (!filename) return reply.code(400).send({ error: "filename required" });

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const mimeType = getMimeType(filename);
      const contentBuffer = Buffer.from(content, "utf-8");

      if (contentBuffer.length > MAX_FILE_SIZE) {
        return reply.code(413).send({ error: "Content too large (max 10MB)" });
      }

      // Write file to disk (path-guarded against traversal).
      const filePath = artifactFilePath(projectId, id, filename);
      fs.writeFileSync(filePath, content, "utf-8");

      db.prepare(
        `INSERT INTO project_artifacts (id, projectId, filename, type, description, tags, sizeBytes, mimeType, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        projectId,
        filename,
        type,
        description || null,
        JSON.stringify(tags),
        contentBuffer.length,
        mimeType,
        now,
        now,
      );

      if (isEmbeddableMimeType(mimeType) && content) {
        embedArtifactInBackground({ projectId, artifactId: id, content, mimeType });
      }

      // Wikilinks: parse [[targets]] synchronously so edges are queryable in the
      // same request. mirror this artifact to a node + resolve its outbound refs,
      // then heal any pending refs from other artifacts pointing at this new one.
      syncArtifactWikilinks(db, { id, projectId, filename, updatedAt: now }, content);
      reresolvePendingForArtifact(db, { id, projectId, filename, updatedAt: now });

      return parseArtifactRow(
        db.prepare("SELECT * FROM project_artifacts WHERE id = ?").get(id) as ArtifactRow,
      );
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

      const existing = db
        .prepare("SELECT * FROM project_artifacts WHERE id = ? AND projectId = ?")
        .get(id, projectId) as ArtifactRow | undefined;
      if (!existing) return reply.code(404).send({ error: "Artifact not found" });

      const fields: string[] = [];
      const values: unknown[] = [];
      const now = new Date().toISOString();

      if (body.filename !== undefined) {
        fields.push("filename = ?");
        values.push(body.filename);
        fields.push("mimeType = ?");
        values.push(getMimeType(body.filename));
      }
      if (body.type !== undefined) {
        fields.push("type = ?");
        values.push(body.type);
      }
      if (body.description !== undefined) {
        fields.push("description = ?");
        values.push(body.description);
      }
      if (body.tags !== undefined) {
        fields.push("tags = ?");
        values.push(JSON.stringify(body.tags));
      }

      if (body.content !== undefined) {
        const contentBuffer = Buffer.from(body.content, "utf-8");
        if (contentBuffer.length > MAX_FILE_SIZE) {
          return reply.code(413).send({ error: "Content too large (max 10MB)" });
        }
        fields.push("sizeBytes = ?");
        values.push(contentBuffer.length);

        // Write updated content to disk (path-guarded against traversal).
        const filePath = artifactFilePath(projectId, id, body.filename || existing.filename);
        fs.writeFileSync(filePath, body.content, "utf-8");
      }

      if (fields.length) {
        fields.push("updatedAt = ?");
        values.push(now);
        values.push(id);
        db.prepare(`UPDATE project_artifacts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      }

      if (body.content !== undefined) {
        const updatedMime = body.filename ? getMimeType(body.filename) : existing.mimeType;
        if (isEmbeddableMimeType(updatedMime)) {
          embedArtifactInBackground({
            projectId,
            artifactId: id,
            content: body.content,
            mimeType: updatedMime,
          });
        }
      }

      // Wikilinks: re-derive synchronously on any content or filename change.
      // A rename updates the mirror node's label, re-resolves OUTBOUND refs from
      // current content, and re-resolves INBOUND refs that now match the new name
      // (refs to the OLD name no longer resolve and fall back to pending-links).
      if (body.content !== undefined || body.filename !== undefined) {
        const newFilename = body.filename ?? existing.filename;
        const content =
          body.content !== undefined ? body.content : readArtifactContent(projectId, existing);
        const ref = { id, projectId, filename: newFilename, updatedAt: now };
        syncArtifactWikilinks(db, ref, content);
        reresolvePendingForArtifact(db, ref);
      }

      return parseArtifactRow(
        db.prepare("SELECT * FROM project_artifacts WHERE id = ?").get(id) as ArtifactRow,
      );
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

function readArtifactContent(projectId: string, row: { id: string; filename: string }): string {
  try {
    const filePath = artifactFilePath(projectId, row.id, row.filename);
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function parseArtifactRow(row: ArtifactRow): Artifact {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]") as string[],
  };
}

function getExtension(filename: string): string {
  const ext = path.extname(filename);
  return ext || ".md";
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".html": "text/html",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".ts": "text/typescript",
    ".js": "text/javascript",
  };
  return mimeMap[ext] || "application/octet-stream";
}

function inferArtifactType(mimeType: string): ArtifactType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "document";
  if (mimeType === "application/json") return "spec";
  if (mimeType.startsWith("text/")) return "document";
  return "other";
}

export default artifactRoutes;
