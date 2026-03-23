import type { FastifyPluginAsync } from "fastify";

const APPS_SCRIPT_REGEX = /^https:\/\/script\.google\.com\/macros\/s\/.+$/;

const syncRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/sync/push", async (request, reply) => {
    const { url, tasks } = request.body as any;

    if (!APPS_SCRIPT_REGEX.test(url)) {
      return reply.code(400).send({ error: "Invalid Google Apps Script URL" });
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "push", tasks }),
      redirect: "error",
    });

    return response.json();
  });

  fastify.post("/sync/pull", async (request, reply) => {
    const { url } = request.body as any;

    if (!APPS_SCRIPT_REGEX.test(url)) {
      return reply.code(400).send({ error: "Invalid Google Apps Script URL" });
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pull" }),
      redirect: "error",
    });

    return response.json();
  });
};

export default syncRoutes;
