import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { spawn } from "../lib/spawn";
import { resolveWithin } from "../lib/path-safety";
import nodePath from "node:path";
import fs from "node:fs";

function getProjectPath(projectId: string): string {
  const db = getDb();
  const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) throw new Error("Project not found");
  return project.path;
}

/**
 * Resolve `userPath` against the project root, enforcing a true boundary check
 * (not a string prefix) and resolving symlinks so in-project symlinks cannot
 * escape the tree. Preserves the historical "Path traversal detected" message.
 */
export function safePath(basePath: string, userPath: string): string {
  try {
    return resolveWithin(basePath, userPath);
  } catch {
    throw new Error("Path traversal detected");
  }
}

// Paths whose *contents* must never be served, even though listing hides dotfiles.
const SECRET_READ_PATTERNS = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.env($|\.)/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)id_rsa/,
  /(^|\/)id_ed25519/,
  /\.pem$/,
  /\.key$/,
];

function isSecretReadPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return SECRET_READ_PATTERNS.some((re) => re.test(normalized));
}

function relFromProject(projectPath: string, fullPath: string): string {
  return nodePath.relative(projectPath, fullPath).replace(/\\/g, "/");
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".bmp",
]);

// Block writes/deletes to sensitive paths within projects
const BLOCKED_PATH_SEGMENTS = [".git/hooks", ".env", ".git/config", ".git/objects"];

export function isBlockedPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return BLOCKED_PATH_SEGMENTS.some(
    (blocked) => normalized === blocked || normalized.startsWith(blocked + "/"),
  );
}

const fileRoutes: FastifyPluginAsync = async (fastify) => {
  // List directory
  fastify.get("/projects/:projectId/files", async (request, reply) => {
    const { projectId } = request.params as any;
    const { path: dirPath = "" } = request.query as any;
    const projectPath = getProjectPath(projectId);
    const fullPath = safePath(projectPath, dirPath);

    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      return entries
        .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
        .map((e) => ({
          name: e.name,
          path: nodePath.relative(projectPath, nodePath.join(fullPath, e.name)).replace(/\\/g, "/"),
          type: e.isDirectory() ? "directory" : "file",
          size: e.isFile() ? fs.statSync(nodePath.join(fullPath, e.name)).size : undefined,
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      return reply.code(404).send({ error: "Directory not found" });
    }
  });

  // Read file
  fastify.get("/projects/:projectId/files/read", async (request, reply) => {
    const { projectId } = request.params as any;
    const { path: filePath } = request.query as any;
    if (!filePath) return reply.code(400).send({ error: "path required" });

    const projectPath = getProjectPath(projectId);
    const fullPath = safePath(projectPath, filePath);

    if (isSecretReadPath(relFromProject(projectPath, fullPath))) {
      return reply.code(403).send({ error: "Cannot read protected file" });
    }

    if (!fs.existsSync(fullPath)) {
      return reply.code(404).send({ error: "File not found" });
    }

    const stat = fs.statSync(fullPath);
    if (stat.size > 5 * 1024 * 1024) {
      return reply.code(413).send({ error: "File too large (max 5MB)" });
    }

    const ext = nodePath.extname(fullPath).toLowerCase();

    if (IMAGE_EXTENSIONS.has(ext)) {
      const content = fs.readFileSync(fullPath).toString("base64");
      return { content, encoding: "base64" };
    }

    const content = fs.readFileSync(fullPath, "utf-8");
    return { content, encoding: "utf-8" };
  });

  // Write file
  fastify.put("/projects/:projectId/files/write", async (request, reply) => {
    const { projectId } = request.params as any;
    const { path: filePath, content } = request.body as { path?: string; content?: string };
    if (typeof filePath !== "string" || filePath.trim() === "")
      return reply.code(400).send({ error: "path required" });
    const projectPath = getProjectPath(projectId);
    const fullPath = safePath(projectPath, filePath);
    // Check the blocklist against the canonicalized path so `./`/`../` segments
    // cannot smuggle a write into .git/hooks, .env, etc.
    if (isBlockedPath(relFromProject(projectPath, fullPath)))
      return reply.code(403).send({ error: "Cannot modify protected file" });

    fs.writeFileSync(fullPath, content ?? "", "utf-8");
    return { ok: true };
  });

  // Create file or directory
  fastify.post("/projects/:projectId/files/create", async (request, reply) => {
    const { projectId } = request.params as any;
    const { path: filePath, type } = request.body as { path?: string; type?: string };
    if (typeof filePath !== "string" || filePath.trim() === "")
      return reply.code(400).send({ error: "path required" });
    const projectPath = getProjectPath(projectId);
    const fullPath = safePath(projectPath, filePath);
    if (isBlockedPath(relFromProject(projectPath, fullPath)))
      return reply.code(403).send({ error: "Cannot create in protected path" });

    if (type === "directory") {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(nodePath.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, "", "utf-8");
    }
    return { ok: true };
  });

  // Rename file
  fastify.post("/projects/:projectId/files/rename", async (request, reply) => {
    const { projectId } = request.params as any;
    const { oldPath, newPath } = request.body as { oldPath?: string; newPath?: string };
    if (
      typeof oldPath !== "string" ||
      typeof newPath !== "string" ||
      !oldPath.trim() ||
      !newPath.trim()
    )
      return reply.code(400).send({ error: "oldPath and newPath required" });
    const projectPath = getProjectPath(projectId);
    const fullOld = safePath(projectPath, oldPath);
    const fullNew = safePath(projectPath, newPath);
    if (
      isBlockedPath(relFromProject(projectPath, fullOld)) ||
      isBlockedPath(relFromProject(projectPath, fullNew))
    )
      return reply.code(403).send({ error: "Cannot modify protected file" });

    fs.renameSync(fullOld, fullNew);
    return { ok: true };
  });

  // Delete file
  fastify.delete("/projects/:projectId/files/delete", async (request, reply) => {
    const { projectId } = request.params as any;
    const { path: filePath } = request.query as any;
    if (typeof filePath !== "string" || filePath.trim() === "")
      return reply.code(400).send({ error: "path required" });
    const projectPath = getProjectPath(projectId);
    const fullPath = safePath(projectPath, filePath);
    // Never allow deleting the project root itself.
    if (relFromProject(projectPath, fullPath) === "")
      return reply.code(400).send({ error: "Refusing to delete project root" });
    if (isBlockedPath(relFromProject(projectPath, fullPath)))
      return reply.code(403).send({ error: "Cannot delete protected file" });

    fs.rmSync(fullPath, { recursive: true });
    return { ok: true };
  });

  // Search file contents (grep)
  fastify.get("/projects/:projectId/files/search", async (request) => {
    const { projectId } = request.params as any;
    const { q, caseSensitive } = request.query as any;
    if (!q) return [];

    const projectPath = getProjectPath(projectId);
    const args = ["grep", "-rn", "--include=*.{ts,tsx,js,jsx,json,css,html,md,py,go,rs}"];
    if (caseSensitive !== "true") args.push("-i");
    args.push(q, ".");

    const result = await spawn(args, { cwd: projectPath, timeout: 10000 });

    return result.stdout
      .split("\n")
      .filter(Boolean)
      .slice(0, 100)
      .map((line) => {
        const match = line.match(/^\.\/(.+?):(\d+):(.*)$/);
        if (!match) return { file: "", line: 0, content: line };
        return { file: match[1], line: parseInt(match[2]), content: match[3].trim() };
      });
  });
};

export default fileRoutes;
