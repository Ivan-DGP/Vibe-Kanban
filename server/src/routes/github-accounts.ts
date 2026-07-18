import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { encrypt, decrypt } from "../lib/crypto";
import { spawn } from "../lib/spawn";
import type { CIStatus, CICheckResult } from "@vibe-kanban/shared";

async function fetchGitHubIdentity(
  token: string,
): Promise<{ username: string; email: string } | null> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id: number; login: string; email: string | null };
    return {
      username: data.login,
      email: data.email ?? `${data.id}+${data.login}@users.noreply.github.com`,
    };
  } catch {
    return null;
  }
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const githubRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.get("/github-accounts", async () => {
    const rows = db.prepare("SELECT * FROM github_accounts ORDER BY name").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      hasToken: true,
      username: r.username ?? null,
      email: r.email ?? null,
      createdAt: r.createdAt,
    }));
  });

  fastify.post("/github-accounts", async (request, reply) => {
    const { name, token } = (request.body ?? {}) as { name?: unknown; token?: unknown };
    if (!isNonEmptyString(name) || !isNonEmptyString(token)) {
      return reply.code(400).send({ error: "name and token are required non-empty strings" });
    }
    const id = crypto.randomUUID();
    const encryptedToken = encrypt(token);
    const ts = new Date().toISOString();
    const identity = await fetchGitHubIdentity(token);

    db.prepare(
      "INSERT INTO github_accounts (id, name, token, username, email, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, name, encryptedToken, identity?.username ?? null, identity?.email ?? null, ts);

    return {
      id,
      name,
      hasToken: true,
      username: identity?.username ?? null,
      email: identity?.email ?? null,
      createdAt: ts,
    };
  });

  fastify.patch("/github-accounts/:id", async (request, reply) => {
    const { id } = request.params as any;
    const { name, token } = (request.body ?? {}) as { name?: unknown; token?: unknown };

    if (name !== undefined && !isNonEmptyString(name)) {
      return reply.code(400).send({ error: "name must be a non-empty string" });
    }
    if (token !== undefined && !isNonEmptyString(token)) {
      return reply.code(400).send({ error: "token must be a non-empty string" });
    }

    const existing = db.prepare("SELECT * FROM github_accounts WHERE id = ?").get(id) as any;
    if (!existing) return reply.code(404).send({ error: "Account not found" });

    const fields: string[] = [];
    const values: any[] = [];

    if (name) {
      fields.push("name = ?");
      values.push(name);
    }
    if (token) {
      fields.push("token = ?");
      values.push(encrypt(token));
      const identity = await fetchGitHubIdentity(token);
      fields.push("username = ?");
      values.push(identity?.username ?? null);
      fields.push("email = ?");
      values.push(identity?.email ?? null);
    }

    if (fields.length) {
      values.push(id);
      db.prepare(`UPDATE github_accounts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare("SELECT * FROM github_accounts WHERE id = ?").get(id) as any;
    return {
      id,
      name: updated.name,
      hasToken: true,
      username: updated.username ?? null,
      email: updated.email ?? null,
      createdAt: updated.createdAt,
    };
  });

  fastify.delete("/github-accounts/:id", async (request, reply) => {
    const { id } = request.params as any;
    db.prepare("DELETE FROM github_accounts WHERE id = ?").run(id);
    return reply.code(204).send();
  });

  // Per-project GitHub account mappings
  fastify.get("/projects/:projectId/github-mapping", async (request) => {
    const { projectId } = request.params as any;
    const rows = db
      .prepare(
        "SELECT m.*, a.name as accountName FROM project_github_mappings m JOIN github_accounts a ON m.githubAccountId = a.id WHERE m.projectId = ?",
      )
      .all(projectId) as any[];
    return rows;
  });

  fastify.put("/projects/:projectId/github-mapping", async (request) => {
    const { projectId } = request.params as any;
    const { subPath, githubAccountId } = request.body as {
      subPath?: string;
      githubAccountId?: string;
    };
    const sub = subPath || "";
    db.prepare(
      "INSERT INTO project_github_mappings (projectId, subPath, githubAccountId) VALUES (?, ?, ?) ON CONFLICT(projectId, subPath) DO UPDATE SET githubAccountId = excluded.githubAccountId",
    ).run(projectId, sub, githubAccountId);
    return { projectId, subPath: sub, githubAccountId };
  });

  fastify.delete("/projects/:projectId/github-mapping", async (request) => {
    const { projectId } = request.params as any;
    const { subPath } = (request.query as any) ?? {};
    db.prepare("DELETE FROM project_github_mappings WHERE projectId = ? AND subPath = ?").run(
      projectId,
      subPath || "",
    );
    return { ok: true };
  });

  // CI/CD status: fetch GitHub Actions run status for a branch
  fastify.get("/projects/:projectId/ci-status", async (request, reply) => {
    const { projectId } = request.params as any;
    const { branch, subPath } = request.query as any;
    if (!branch) return reply.code(400).send({ error: "branch query param required" });

    // Find the GitHub account mapped to this project
    const sub = subPath || "";
    const mapping = db
      .prepare(
        "SELECT m.githubAccountId, a.token FROM project_github_mappings m JOIN github_accounts a ON m.githubAccountId = a.id WHERE m.projectId = ? AND m.subPath = ?",
      )
      .get(projectId, sub) as { githubAccountId: string; token: string } | undefined;

    if (!mapping) {
      return reply.code(404).send({ error: "No GitHub account mapped for this project" });
    }

    const token = decrypt(mapping.token);

    // Detect owner/repo from the project's git remote
    const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as
      | { path: string }
      | undefined;
    if (!project) return reply.code(404).send({ error: "Project not found" });

    let repoFullName: string | null = null;
    try {
      const cwd = sub ? `${project.path}/${sub}` : project.path;
      const result = await spawn(["git", "remote", "get-url", "origin"], { cwd });
      const url = result.stdout.trim();
      // Parse owner/repo from git URL (SSH or HTTPS)
      const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
      if (match) repoFullName = match[1].replace(/\.git$/, "");
    } catch {
      // ignore
    }

    if (!repoFullName) {
      return reply.code(404).send({ error: "Could not determine GitHub repo from git remote" });
    }

    // Fetch latest workflow run for this branch
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoFullName}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (!res.ok) {
        const body = await res.text();
        fastify.log.warn(`GitHub API error: ${res.status} ${body}`);
        return reply.code(res.status).send({ error: "GitHub API error" });
      }

      const data = (await res.json()) as any;
      const runs = data.workflow_runs || [];

      if (runs.length === 0) {
        return {
          branch,
          status: "unknown" as CIStatus,
          conclusion: null,
          workflowName: null,
          runUrl: null,
          updatedAt: null,
        } satisfies CICheckResult;
      }

      const run = runs[0];
      let status: CIStatus = "unknown";
      if (run.status === "queued" || run.status === "waiting" || run.status === "pending") {
        status = "pending";
      } else if (run.status === "in_progress") {
        status = "running";
      } else if (run.status === "completed") {
        status = run.conclusion === "success" ? "success" : "failure";
      }

      return {
        branch,
        status,
        conclusion: run.conclusion,
        workflowName: run.name,
        runUrl: run.html_url,
        updatedAt: run.updated_at,
      } satisfies CICheckResult;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: "Failed to fetch CI status" });
    }
  });

  // Batch CI status: fetch for multiple branches at once
  fastify.post("/projects/:projectId/ci-status/batch", async (request, reply) => {
    const { projectId } = request.params as any;
    const { branches, subPath } = request.body as { branches?: string[]; subPath?: string };
    if (!branches || !Array.isArray(branches) || branches.length === 0) {
      return reply.code(400).send({ error: "branches array required" });
    }

    const sub = subPath || "";
    const mapping = db
      .prepare(
        "SELECT m.githubAccountId, a.token FROM project_github_mappings m JOIN github_accounts a ON m.githubAccountId = a.id WHERE m.projectId = ? AND m.subPath = ?",
      )
      .get(projectId, sub) as { githubAccountId: string; token: string } | undefined;

    if (!mapping) {
      return reply.code(404).send({ error: "No GitHub account mapped" });
    }

    const token = decrypt(mapping.token);

    const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as
      | { path: string }
      | undefined;
    if (!project) return reply.code(404).send({ error: "Project not found" });

    let repoFullName: string | null = null;
    try {
      const cwd = sub ? `${project.path}/${sub}` : project.path;
      const result = await spawn(["git", "remote", "get-url", "origin"], { cwd });
      const url = result.stdout.trim();
      const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
      if (match) repoFullName = match[1].replace(/\.git$/, "");
    } catch {
      // ignore
    }

    if (!repoFullName) {
      return reply.code(404).send({ error: "Could not determine GitHub repo" });
    }

    // Fetch runs for all branches concurrently (limit to 10)
    const uniqueBranches = [...new Set(branches as string[])].slice(0, 10);
    const results: CICheckResult[] = await Promise.all(
      uniqueBranches.map(async (branch: string) => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/${repoFullName}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
              signal: AbortSignal.timeout(15_000),
            },
          );
          if (!res.ok) {
            return {
              branch,
              status: "unknown" as CIStatus,
              conclusion: null,
              workflowName: null,
              runUrl: null,
              updatedAt: null,
            };
          }
          const data = (await res.json()) as any;
          const runs = data.workflow_runs || [];
          if (runs.length === 0) {
            return {
              branch,
              status: "unknown" as CIStatus,
              conclusion: null,
              workflowName: null,
              runUrl: null,
              updatedAt: null,
            };
          }
          const run = runs[0];
          let status: CIStatus = "unknown";
          if (run.status === "queued" || run.status === "waiting" || run.status === "pending")
            status = "pending";
          else if (run.status === "in_progress") status = "running";
          else if (run.status === "completed")
            status = run.conclusion === "success" ? "success" : "failure";
          return {
            branch,
            status,
            conclusion: run.conclusion,
            workflowName: run.name,
            runUrl: run.html_url,
            updatedAt: run.updated_at,
          };
        } catch {
          return {
            branch,
            status: "unknown" as CIStatus,
            conclusion: null,
            workflowName: null,
            runUrl: null,
            updatedAt: null,
          };
        }
      }),
    );

    return results;
  });
};

export default githubRoutes;
