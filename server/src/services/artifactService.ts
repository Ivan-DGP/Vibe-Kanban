import { getDb } from "../db";
import { getProjectArtifactsDir } from "../lib/data-dir";
import { resolveWithin } from "../lib/path-safety";
import { embedArtifactInBackground } from "./artifactEmbedder";
import { syncArtifactWikilinks, reresolvePendingForArtifact } from "./wikilinks";
import { isEmbeddableMimeType } from "../lib/chunking";
import fs from "node:fs";
import path from "node:path";
import type {
  Artifact,
  ArtifactType,
  CreateArtifactInput as SharedCreateArtifactInput,
  UpdateArtifactInput as SharedUpdateArtifactInput,
} from "@vibe-kanban/shared";

export const MAX_ARTIFACT_SIZE = 10 * 1024 * 1024; // 10MB

// Raw row shape from project_artifacts. `tags` is stored as a JSON string.
export interface ArtifactRow {
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

/** Thrown for caller-input failures so HTTP routes map to a status code and
 *  MCP tools surface `{ error }`. */
export class ArtifactError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ArtifactError";
  }
}

/**
 * Resolve the on-disk path for an artifact's stored file, guaranteeing it stays
 * within the project's artifacts dir even after symlink resolution. The leaf is
 * always `<uuid><ext>`; resolveWithin is defense-in-depth against any traversal
 * sneaking in through the derived extension.
 */
export function artifactFilePath(projectId: string, id: string, filename: string): string {
  const artifactsDir = getProjectArtifactsDir(projectId);
  return resolveWithin(artifactsDir, id + getExtension(filename));
}

export function readArtifactContent(
  projectId: string,
  row: { id: string; filename: string },
): string {
  try {
    const filePath = artifactFilePath(projectId, row.id, row.filename);
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function parseArtifactRow(row: ArtifactRow): Artifact {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]") as string[],
  };
}

export function getExtension(filename: string): string {
  const ext = path.extname(filename);
  return ext || ".md";
}

export function getMimeType(filename: string): string {
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

export function inferArtifactType(mimeType: string): ArtifactType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "document";
  if (mimeType === "application/json") return "spec";
  if (mimeType.startsWith("text/")) return "document";
  return "other";
}

// Server-side create input: the shared DTO plus the owning project id.
export interface CreateArtifactInput extends SharedCreateArtifactInput {
  projectId: string;
}

/**
 * Create an artifact: write file to disk, insert row, kick off embedding, and
 * synchronously resolve wikilinks. Shared by the HTTP route and the MCP
 * `create_artifact` tool so both paths stay identical. Throws ArtifactError on
 * bad input.
 */
export function createArtifact(input: CreateArtifactInput): Artifact {
  const { projectId, filename, type = "document", description, tags = [], content = "" } = input;

  if (!filename) throw new ArtifactError(400, "filename required");

  const contentBuffer = Buffer.from(content, "utf-8");
  if (contentBuffer.length > MAX_ARTIFACT_SIZE) {
    throw new ArtifactError(413, "Content too large (max 10MB)");
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const mimeType = getMimeType(filename);

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
  // same request. Mirror this artifact to a node + resolve its outbound refs,
  // then heal any pending refs from other artifacts pointing at this new one.
  syncArtifactWikilinks(db, { id, projectId, filename, updatedAt: now }, content);
  reresolvePendingForArtifact(db, { id, projectId, filename, updatedAt: now });

  return parseArtifactRow(
    db.prepare("SELECT * FROM project_artifacts WHERE id = ?").get(id) as ArtifactRow,
  );
}

// Server-side update input: the shared DTO plus the target project + artifact id.
export interface UpdateArtifactInput extends SharedUpdateArtifactInput {
  projectId: string;
  id: string;
}

/**
 * Update an artifact's metadata and/or content. Returns the updated Artifact or
 * null if not found. Mirrors the disk write + embed + wikilink re-resolution of
 * the create path. Throws ArtifactError on bad input.
 */
export function updateArtifact(input: UpdateArtifactInput): Artifact | null {
  const db = getDb();
  const { projectId, id } = input;

  const existing = db
    .prepare("SELECT * FROM project_artifacts WHERE id = ? AND projectId = ?")
    .get(id, projectId) as ArtifactRow | undefined;
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];
  const now = new Date().toISOString();

  if (input.filename !== undefined) {
    fields.push("filename = ?");
    values.push(input.filename);
    fields.push("mimeType = ?");
    values.push(getMimeType(input.filename));
  }
  if (input.type !== undefined) {
    fields.push("type = ?");
    values.push(input.type);
  }
  if (input.description !== undefined) {
    fields.push("description = ?");
    values.push(input.description);
  }
  if (input.tags !== undefined) {
    fields.push("tags = ?");
    values.push(JSON.stringify(input.tags));
  }

  if (input.content !== undefined) {
    const contentBuffer = Buffer.from(input.content, "utf-8");
    if (contentBuffer.length > MAX_ARTIFACT_SIZE) {
      throw new ArtifactError(413, "Content too large (max 10MB)");
    }
    fields.push("sizeBytes = ?");
    values.push(contentBuffer.length);

    // Write updated content to disk (path-guarded against traversal).
    const filePath = artifactFilePath(projectId, id, input.filename || existing.filename);
    fs.writeFileSync(filePath, input.content, "utf-8");
  }

  if (fields.length) {
    fields.push("updatedAt = ?");
    values.push(now);
    values.push(id);
    db.prepare(`UPDATE project_artifacts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  if (input.content !== undefined) {
    const updatedMime = input.filename ? getMimeType(input.filename) : existing.mimeType;
    if (isEmbeddableMimeType(updatedMime)) {
      embedArtifactInBackground({
        projectId,
        artifactId: id,
        content: input.content,
        mimeType: updatedMime,
      });
    }
  }

  // Wikilinks: re-derive synchronously on any content or filename change.
  if (input.content !== undefined || input.filename !== undefined) {
    const newFilename = input.filename ?? existing.filename;
    const content =
      input.content !== undefined ? input.content : readArtifactContent(projectId, existing);
    const ref = { id, projectId, filename: newFilename, updatedAt: now };
    syncArtifactWikilinks(db, ref, content);
    reresolvePendingForArtifact(db, ref);
  }

  return parseArtifactRow(
    db.prepare("SELECT * FROM project_artifacts WHERE id = ?").get(id) as ArtifactRow,
  );
}
