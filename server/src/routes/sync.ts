import type { FastifyPluginAsync } from "fastify";
import { safeFetch } from "../lib/ssrf-guard";

export const APPS_SCRIPT_REGEX = /^https:\/\/script\.google\.com\/macros\/s\/.+$/;

// Apps Script 302-redirects to script.googleusercontent.com; safeFetch follows
// redirects but re-validates each hop against SSRF, so an open redirect can't
// pivot to an internal host.
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB cap on untrusted Apps Script body

/** Read response body with a hard size cap, then JSON-parse it. */
async function readCappedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error("Sync response exceeds size limit");
  }
  return JSON.parse(text);
}

const syncRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/sync/push", async (request, reply) => {
    const { url, tasks } = request.body as any;

    if (!APPS_SCRIPT_REGEX.test(url)) {
      return reply.code(400).send({ error: "Invalid Google Apps Script URL" });
    }

    const response = await safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "push", tasks }),
      signal: AbortSignal.timeout(30_000),
    });

    return readCappedJson(response);
  });

  fastify.post("/sync/pull", async (request, reply) => {
    const { url } = request.body as any;

    if (!APPS_SCRIPT_REGEX.test(url)) {
      return reply.code(400).send({ error: "Invalid Google Apps Script URL" });
    }

    const response = await safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pull" }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await readCappedJson(response);
    // Untrusted body: enforce basic shape before it's written back to tasks.
    if (typeof data !== "object" || data === null) {
      return reply.code(502).send({ error: "Malformed sync response" });
    }
    const { tasks } = data as { tasks?: unknown };
    if (tasks !== undefined && !Array.isArray(tasks)) {
      return reply.code(502).send({ error: "Malformed sync response: tasks not an array" });
    }
    return data;
  });
};

export default syncRoutes;
