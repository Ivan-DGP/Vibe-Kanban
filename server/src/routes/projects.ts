import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { log } from "../lib/logger";
import type { Project } from "@vibe-kanban/shared";
import fs from "node:fs";
import path from "node:path";

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

// Tech stack detection from package.json and config files
export function detectTechStack(projectPath: string): string[] {
  const techs: string[] = [];

  try {
    const pkgPath = path.join(projectPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      const depMap: Record<string, string> = {
        react: "React",
        "react-dom": "React",
        vue: "Vue",
        svelte: "Svelte",
        "next": "Next.js",
        nuxt: "Nuxt",
        fastify: "Fastify",
        express: "Express",
        tailwindcss: "Tailwind",
        typescript: "TypeScript",
        vite: "Vite",
        webpack: "Webpack",
        prisma: "Prisma",
        drizzle: "Drizzle",
        "@angular/core": "Angular",
        "solid-js": "SolidJS",
        astro: "Astro",
        electron: "Electron",
      };

      for (const [dep, name] of Object.entries(depMap)) {
        if (allDeps[dep]) techs.push(name);
      }
    }
  } catch {}

  try {
    if (fs.existsSync(path.join(projectPath, "tsconfig.json"))) techs.push("TypeScript");
    if (fs.existsSync(path.join(projectPath, "Cargo.toml"))) techs.push("Rust");
    if (fs.existsSync(path.join(projectPath, "go.mod"))) techs.push("Go");
    if (fs.existsSync(path.join(projectPath, "requirements.txt"))) techs.push("Python");
    if (fs.existsSync(path.join(projectPath, "pyproject.toml"))) techs.push("Python");
  } catch {}

  return [...new Set(techs)];
}

const PROJECT_MARKERS = [
  "package.json",
  ".git",
  "Cargo.toml",
  "go.mod",
  "requirements.txt",
  "pyproject.toml",
];

export function scanDirectory(dir: string, depth = 0, maxDepth = 3): { name: string; path: string; techStack: string[] }[] {
  const results: { name: string; path: string; techStack: string[] }[] = [];
  if (depth > maxDepth) return results;

  try {
    const hasMarker = PROJECT_MARKERS.some((m) =>
      fs.existsSync(path.join(dir, m)),
    );

    if (hasMarker) {
      results.push({
        name: path.basename(dir),
        path: dir,
        techStack: detectTechStack(dir),
      });
      return results; // Don't recurse into discovered projects
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        results.push(...scanDirectory(path.join(dir, entry.name), depth + 1, maxDepth));
      }
    }
  } catch {}

  return results;
}

function rowToProject(row: any): Project {
  return {
    ...row,
    favorite: !!row.favorite,
    techStack: JSON.parse(row.techStack || "[]"),
    externalLinks: JSON.parse(row.externalLinks || "[]"),
    autoSpawnEnabled: !!row.autoSpawnEnabled,
  };
}

const PROJECT_MARKERS_SET = new Set(["package.json", "Cargo.toml", "go.mod", "pyproject.toml", "pom.xml", "build.gradle", ".git"]);

const projectRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // Browse filesystem directories
  fastify.get("/browse", async (request) => {
    const { dir } = request.query as { dir?: string };
    const targetDir = dir || (process.env.HOME || process.env.USERPROFILE || "C:/Users");

    try {
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      const folders: { name: string; path: string; isProject: boolean }[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") continue;
        const fullPath = path.join(targetDir, entry.name);
        // Check if it looks like a project
        let isProject = false;
        try {
          const children = fs.readdirSync(fullPath);
          isProject = children.some((c) => PROJECT_MARKERS_SET.has(c));
        } catch {}
        folders.push({ name: entry.name, path: fullPath, isProject });
      }

      // Sort: projects first, then alphabetically
      folders.sort((a, b) => {
        if (a.isProject !== b.isProject) return a.isProject ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { current: targetDir, parent: path.dirname(targetDir), folders };
    } catch {
      return { current: targetDir, parent: path.dirname(targetDir), folders: [] };
    }
  });

  // List projects
  fastify.get("/projects", async (request) => {
    const { favorite, category } = request.query as any;
    let sql = "SELECT * FROM projects";
    const conditions: string[] = [];
    const params: any[] = [];

    if (favorite !== undefined) {
      conditions.push("favorite = ?");
      params.push(favorite === "true" ? 1 : 0);
    }
    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }

    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY favorite DESC, name ASC";

    const rows = db.prepare(sql).all(...params);
    return (rows as any[]).map(rowToProject);
  });

  // Get project
  fastify.get("/projects/:id", async (request, reply) => {
    const { id } = request.params as any;
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    if (!row) return reply.code(404).send({ error: "Project not found" });
    return rowToProject(row);
  });

  // Create project
  fastify.post("/projects", async (request) => {
    const { name, path: projectPath, category } = request.body as any;
    const id = uuid();
    const techStack = detectTechStack(projectPath);
    const ts = now();

    db.prepare(
      `INSERT INTO projects (id, name, path, category, techStack, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, name, projectPath, category || null, JSON.stringify(techStack), ts, ts);

    log("info", "server", `Project created: ${name}`);

    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return rowToProject(row);
  });

  // Update project
  fastify.patch("/projects/:id", async (request, reply) => {
    const { id } = request.params as any;
    const updates = request.body as any;

    const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Project not found" });

    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (key === "techStack" || key === "externalLinks") {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else if (key === "favorite") {
        fields.push("favorite = ?");
        values.push(value ? 1 : 0);
      } else if (key === "autoSpawnEnabled") {
        fields.push("autoSpawnEnabled = ?");
        values.push(value ? 1 : 0);
      } else if (["name", "category", "aiCommitMode", "notionDatabaseId", "treeDepth", "aiInstructions", "qaAgentPath", "qaAgentPython"].includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) return rowToProject(existing);

    fields.push("updatedAt = ?");
    values.push(now());
    values.push(id);

    db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(
      ...values,
    );

    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return rowToProject(row);
  });

  // Delete project
  fastify.delete("/projects/:id", async (request, reply) => {
    const { id } = request.params as any;
    const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Project not found" });

    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    log("info", "server", `Project deleted: ${(existing as any).name}`);
    return reply.code(204).send();
  });

  // Scan directories
  fastify.post("/projects/scan", async (request) => {
    const { directories } = request.body as { directories: string[] };
    const results: { name: string; path: string; techStack: string[] }[] = [];

    for (const dir of directories) {
      if (fs.existsSync(dir)) {
        results.push(...scanDirectory(dir));
      }
    }

    // Filter out already-added projects
    const existingPaths = new Set(
      (db.prepare("SELECT path FROM projects").all() as any[]).map((r) => r.path),
    );

    return results.filter((r) => !existingPaths.has(r.path));
  });
};

export default projectRoutes;
