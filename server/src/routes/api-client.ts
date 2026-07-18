import type { FastifyPluginAsync } from "fastify";
import type {
  CreateApiCollectionInput,
  UpdateApiCollectionInput,
  CreateApiRequestInput,
  UpdateApiRequestInput,
  ApiRequestExecuteInput,
} from "@vibe-kanban/shared";
import { getDb } from "../db";
import { proxyFetch, SsrfError } from "../lib/ssrf-guard";
import { isAllowedOrigin } from "../lib/origin";

const apiClientRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // ============ Collections ============

  fastify.get("/projects/:projectId/api-collections", async (request) => {
    const { projectId } = request.params as any;
    const rows = db
      .prepare("SELECT * FROM api_collections WHERE projectId = ? ORDER BY sortOrder, name")
      .all(projectId) as any[];
    return rows;
  });

  fastify.post("/projects/:projectId/api-collections", async (request) => {
    const { projectId } = request.params as any;
    const { name } = request.body as CreateApiCollectionInput;
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();

    // Get max sort order
    const max = db
      .prepare("SELECT MAX(sortOrder) as m FROM api_collections WHERE projectId = ?")
      .get(projectId) as { m: number | null } | undefined;
    const sortOrder = (max?.m ?? 0) + 1;

    db.prepare(
      "INSERT INTO api_collections (id, projectId, name, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, projectId, name, sortOrder, ts, ts);

    return { id, projectId, name, sortOrder, createdAt: ts, updatedAt: ts };
  });

  fastify.patch("/api-collections/:id", async (request, reply) => {
    const { id } = request.params as any;
    const updates = request.body as UpdateApiCollectionInput;

    const existing = db.prepare("SELECT * FROM api_collections WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Collection not found" });

    const fields: string[] = [];
    const values: any[] = [];
    if (updates.name !== undefined) {
      fields.push("name = ?");
      values.push(updates.name);
    }
    if (updates.sortOrder !== undefined) {
      fields.push("sortOrder = ?");
      values.push(updates.sortOrder);
    }

    if (fields.length) {
      fields.push("updatedAt = ?");
      values.push(new Date().toISOString());
      values.push(id);
      db.prepare(`UPDATE api_collections SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }

    return db.prepare("SELECT * FROM api_collections WHERE id = ?").get(id);
  });

  fastify.delete("/api-collections/:id", async (request, reply) => {
    const { id } = request.params as any;
    db.prepare("DELETE FROM api_collections WHERE id = ?").run(id);
    return reply.code(204).send();
  });

  // ============ Requests ============

  fastify.get("/api-collections/:collectionId/requests", async (request) => {
    const { collectionId } = request.params as any;
    const rows = db
      .prepare("SELECT * FROM api_requests WHERE collectionId = ? ORDER BY sortOrder, name")
      .all(collectionId) as any[];
    return rows;
  });

  fastify.get("/projects/:projectId/api-requests", async (request) => {
    const { projectId } = request.params as any;
    const rows = db
      .prepare(
        `SELECT r.* FROM api_requests r
         JOIN api_collections c ON r.collectionId = c.id
         WHERE c.projectId = ?
         ORDER BY c.sortOrder, r.sortOrder, r.name`,
      )
      .all(projectId) as any[];
    return rows;
  });

  fastify.post("/api-requests", async (request) => {
    const body = request.body as CreateApiRequestInput;
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();

    const max = db
      .prepare("SELECT MAX(sortOrder) as m FROM api_requests WHERE collectionId = ?")
      .get(body.collectionId) as { m: number | null } | undefined;
    const sortOrder = (max?.m ?? 0) + 1;

    db.prepare(
      `INSERT INTO api_requests (id, collectionId, name, method, url, headers, body, sortOrder, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      body.collectionId,
      body.name || "New Request",
      body.method || "GET",
      body.url || "",
      body.headers || "{}",
      body.body || "",
      sortOrder,
      ts,
      ts,
    );

    return db.prepare("SELECT * FROM api_requests WHERE id = ?").get(id);
  });

  fastify.patch("/api-requests/:id", async (request, reply) => {
    const { id } = request.params as any;
    const updates = request.body as UpdateApiRequestInput;

    const existing = db.prepare("SELECT * FROM api_requests WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Request not found" });

    const fields: string[] = [];
    const values: any[] = [];
    for (const key of [
      "name",
      "method",
      "url",
      "headers",
      "body",
      "sortOrder",
      "lastResponseStatus",
      "lastResponseTime",
    ] as (keyof UpdateApiRequestInput)[]) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    }

    if (fields.length) {
      fields.push("updatedAt = ?");
      values.push(new Date().toISOString());
      values.push(id);
      db.prepare(`UPDATE api_requests SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }

    return db.prepare("SELECT * FROM api_requests WHERE id = ?").get(id);
  });

  fastify.delete("/api-requests/:id", async (request, reply) => {
    const { id } = request.params as any;
    db.prepare("DELETE FROM api_requests WHERE id = ?").run(id);
    return reply.code(204).send();
  });

  // ============ Execute Request (Proxy) ============

  fastify.post("/api-client/execute", async (request, reply) => {
    // CSRF: a cross-origin web page the developer visits must not be able to
    // drive this server-side proxy. Browsers always send Origin on such requests;
    // same-origin (and non-browser/no-Origin) callers are allowed through.
    const origin = request.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      return reply.code(403).send({ error: "Cross-origin request blocked" });
    }

    const { method, url, headers, body } = request.body as ApiRequestExecuteInput;

    if (!url) return reply.code(400).send({ error: "url is required" });

    const startTime = Date.now();

    try {
      const fetchHeaders: Record<string, string> = {};
      if (headers && typeof headers === "object") {
        for (const [k, v] of Object.entries(headers)) {
          if (typeof v === "string" && v.trim()) fetchHeaders[k] = v;
        }
      }

      const fetchOptions: RequestInit = {
        method: method || "GET",
        headers: fetchHeaders,
      };

      // Only attach body for methods that support it
      if (body && !["GET", "HEAD"].includes((method || "GET").toUpperCase())) {
        fetchOptions.body = body;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      fetchOptions.signal = controller.signal;

      // SSRF guard: block http(s)-only, reject loopback/link-local/metadata/private
      // targets, and re-validate every redirect hop. Without this, any web page the
      // user visits can drive this server-side fetch at internal services.
      let res: Response;
      try {
        res = await proxyFetch(url, fetchOptions);
      } catch (e: any) {
        clearTimeout(timeout);
        if (e instanceof SsrfError) {
          return reply.code(400).send({ error: e.message });
        }
        throw e;
      }
      clearTimeout(timeout);

      const timeMs = Date.now() - startTime;

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });

      let responseBody: string;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("json")) {
        const json = await res.json();
        responseBody = JSON.stringify(json, null, 2);
      } else {
        responseBody = await res.text();
      }

      return {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        body: responseBody,
        timeMs,
      };
    } catch (err: any) {
      const timeMs = Date.now() - startTime;
      return reply.code(502).send({
        status: 0,
        statusText: "Network Error",
        headers: {},
        body: err.message || "Request failed",
        timeMs,
      });
    }
  });
};

export default apiClientRoutes;
