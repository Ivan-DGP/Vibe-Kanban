import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { encrypt, decrypt } from "../lib/crypto";

const githubRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.get("/github-accounts", async () => {
    const rows = db.prepare("SELECT * FROM github_accounts ORDER BY name").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      hasToken: true,
      createdAt: r.createdAt,
    }));
  });

  fastify.post("/github-accounts", async (request) => {
    const { name, token } = request.body as any;
    const id = crypto.randomUUID();
    const encryptedToken = encrypt(token);
    const ts = new Date().toISOString();

    db.prepare(
      "INSERT INTO github_accounts (id, name, token, createdAt) VALUES (?, ?, ?, ?)",
    ).run(id, name, encryptedToken, ts);

    return { id, name, hasToken: true, createdAt: ts };
  });

  fastify.patch("/github-accounts/:id", async (request, reply) => {
    const { id } = request.params as any;
    const { name, token } = request.body as any;

    const existing = db.prepare("SELECT * FROM github_accounts WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Account not found" });

    const fields: string[] = [];
    const values: any[] = [];

    if (name) { fields.push("name = ?"); values.push(name); }
    if (token) { fields.push("token = ?"); values.push(encrypt(token)); }

    if (fields.length) {
      values.push(id);
      db.prepare(`UPDATE github_accounts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }

    return { id, name: name || (existing as any).name, hasToken: true, createdAt: (existing as any).createdAt };
  });

  fastify.delete("/github-accounts/:id", async (request, reply) => {
    const { id } = request.params as any;
    db.prepare("DELETE FROM github_accounts WHERE id = ?").run(id);
    return reply.code(204).send();
  });

  // Per-project GitHub account mappings
  fastify.get("/projects/:projectId/github-mapping", async (request) => {
    const { projectId } = request.params as any;
    const rows = db.prepare(
      "SELECT m.*, a.name as accountName FROM project_github_mappings m JOIN github_accounts a ON m.githubAccountId = a.id WHERE m.projectId = ?",
    ).all(projectId) as any[];
    return rows;
  });

  fastify.put("/projects/:projectId/github-mapping", async (request) => {
    const { projectId } = request.params as any;
    const { subPath, githubAccountId } = request.body as any;
    const sub = subPath || "";
    db.prepare(
      "INSERT INTO project_github_mappings (projectId, subPath, githubAccountId) VALUES (?, ?, ?) ON CONFLICT(projectId, subPath) DO UPDATE SET githubAccountId = excluded.githubAccountId",
    ).run(projectId, sub, githubAccountId);
    return { projectId, subPath: sub, githubAccountId };
  });

  fastify.delete("/projects/:projectId/github-mapping", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = request.body as any;
    db.prepare("DELETE FROM project_github_mappings WHERE projectId = ? AND subPath = ?").run(projectId, subPath || "");
    return { ok: true };
  });
};

export default githubRoutes;
