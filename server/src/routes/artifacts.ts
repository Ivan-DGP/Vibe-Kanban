import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { getProjectArtifactsDir } from "../lib/data-dir";
import { embedArtifactInBackground } from "../services/artifactEmbedder";
import { isEmbeddableMimeType } from "../lib/chunking";
import fs from "node:fs";
import path from "node:path";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const artifactRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // List artifacts for a project
  fastify.get("/projects/:projectId/artifacts", async (request) => {
    const { projectId } = request.params as any;
    const { type, search, limit = "50", offset = "0" } = request.query as any;

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
    const total = (db.prepare(countSql).get(...(bindings as [unknown, ...unknown[]])) as any).total;

    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);
    sql += " ORDER BY updatedAt DESC LIMIT ? OFFSET ?";
    bindings.push(limitNum, offsetNum);

    const items = (db.prepare(sql).all(...(bindings as [unknown, ...unknown[]])) as any[]).map(
      parseArtifactRow,
    );

    return { items, total, hasMore: offsetNum + items.length < total };
  });

  // Get single artifact metadata
  fastify.get("/projects/:projectId/artifacts/:id", async (request, reply) => {
    const { projectId, id } = request.params as any;
    const row = db
      .prepare("SELECT * FROM project_artifacts WHERE id = ? AND projectId = ?")
      .get(id, projectId);
    if (!row) return reply.code(404).send({ error: "Artifact not found" });
    return parseArtifactRow(row as any);
  });

  // Get artifact content (file bytes or text)
  fastify.get("/projects/:projectId/artifacts/:id/content", async (request, reply) => {
    const { projectId, id } = request.params as any;
    const row = db
      .prepare("SELECT * FROM project_artifacts WHERE id = ? AND projectId = ?")
      .get(id, projectId) as any;
    if (!row) return reply.code(404).send({ error: "Artifact not found" });

    const artifactsDir = getProjectArtifactsDir(projectId);
    const filePath = path.join(artifactsDir, row.id + getExtension(row.filename));
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: "Artifact file not found on disk" });
    }

    const isText = row.mimeType.startsWith("text/") || row.mimeType === "application/json";
    if (isText) {
      return { content: fs.readFileSync(filePath, "utf-8"), encoding: "utf-8" };
    }
    return { content: fs.readFileSync(filePath).toString("base64"), encoding: "base64" };
  });

  // Create artifact
  fastify.post("/projects/:projectId/artifacts", async (request, reply) => {
    const { projectId } = request.params as any;
    const {
      filename,
      type = "document",
      description,
      tags = [],
      content = "",
    } = request.body as any;

    if (!filename) return reply.code(400).send({ error: "filename required" });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const mimeType = getMimeType(filename);
    const contentBuffer = Buffer.from(content, "utf-8");

    if (contentBuffer.length > MAX_FILE_SIZE) {
      return reply.code(413).send({ error: "Content too large (max 10MB)" });
    }

    // Write file to disk
    const artifactsDir = getProjectArtifactsDir(projectId);
    const filePath = path.join(artifactsDir, id + getExtension(filename));
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

    return parseArtifactRow(
      db.prepare("SELECT * FROM project_artifacts WHERE id = ?").get(id) as any,
    );
  });

  // Update artifact metadata and/or content
  fastify.patch("/projects/:projectId/artifacts/:id", async (request, reply) => {
    const { projectId, id } = request.params as any;
    const body = request.body as any;

    const existing = db
      .prepare("SELECT * FROM project_artifacts WHERE id = ? AND projectId = ?")
      .get(id, projectId) as any;
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

      // Write updated content to disk
      const artifactsDir = getProjectArtifactsDir(projectId);
      const ext = getExtension(body.filename || existing.filename);
      const filePath = path.join(artifactsDir, id + ext);
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

    return parseArtifactRow(
      db.prepare("SELECT * FROM project_artifacts WHERE id = ?").get(id) as any,
    );
  });

  // Upload artifact (multipart file)
  fastify.post("/projects/:projectId/artifacts/upload", async (request, reply) => {
    const { projectId } = request.params as any;

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
    const ext = getExtension(originalFilename);
    const mimeType = file.mimetype || getMimeType(originalFilename);
    const type = inferArtifactType(mimeType);

    // Write to disk
    const artifactsDir = getProjectArtifactsDir(projectId);
    const filePath = path.join(artifactsDir, id + ext);
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
      db.prepare("SELECT * FROM project_artifacts WHERE id = ?").get(id) as any,
    );
  });

  // Delete artifact
  fastify.delete("/projects/:projectId/artifacts/:id", async (request, reply) => {
    const { projectId, id } = request.params as any;
    const existing = db
      .prepare("SELECT * FROM project_artifacts WHERE id = ? AND projectId = ?")
      .get(id, projectId) as any;
    if (!existing) return reply.code(404).send({ error: "Artifact not found" });

    // Delete file from disk
    const artifactsDir = getProjectArtifactsDir(projectId);
    const filePath = path.join(artifactsDir, id + getExtension(existing.filename));
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
    }

    db.prepare("DELETE FROM project_artifacts WHERE id = ?").run(id);
    return reply.code(204).send();
  });
};

function parseArtifactRow(row: any) {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
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

function inferArtifactType(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "document";
  if (mimeType === "application/json") return "spec";
  if (mimeType.startsWith("text/")) return "document";
  return "other";
}

export default artifactRoutes;
