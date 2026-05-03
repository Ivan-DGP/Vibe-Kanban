import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import path from "node:path";
import { getDb, closeDb } from "./db";
import { registerSpawnConfigs } from "./services/registerSpawnConfigs";

export async function buildApp(opts: { bodyLimit?: number } = {}) {
  const app = Fastify({ logger: true, bodyLimit: opts.bodyLimit });

  // Initialize database
  getDb();

  // Register multi-session orchestration spawn configs
  registerSpawnConfigs();

  // Plugins
  await app.register(cors, {
    origin: [
      "http://localhost:5173",
      "http://localhost:3001",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:3001",
    ],
  });
  await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(fastifyWebsocket);

  // In production, serve the Vite build
  if (process.env.NODE_ENV === "production") {
    await app.register(fastifyStatic, {
      root: path.resolve(import.meta.dir, "../../client/dist"),
      prefix: "/",
    });
  }

  // Register route plugins
  await app.register(import("./routes/projects"), { prefix: "/api" });
  await app.register(import("./routes/tasks"), { prefix: "/api" });
  await app.register(import("./routes/milestones"), { prefix: "/api" });
  await app.register(import("./routes/settings"), { prefix: "/api" });
  await app.register(import("./routes/logs"), { prefix: "/api" });
  await app.register(import("./routes/reports"), { prefix: "/api" });
  await app.register(import("./routes/git"), { prefix: "/api" });
  await app.register(import("./routes/files"), { prefix: "/api" });
  await app.register(import("./routes/claude"), { prefix: "/api" });
  await app.register(import("./routes/github-accounts"), { prefix: "/api" });
  await app.register(import("./routes/sync"), { prefix: "/api" });
  await app.register(import("./routes/notion"), { prefix: "/api" });
  await app.register(import("./routes/todos"), { prefix: "/api" });
  await app.register(import("./routes/api-client"), { prefix: "/api" });
  await app.register(import("./routes/artifacts"), { prefix: "/api" });
  await app.register(import("./routes/roadmap"), { prefix: "/api" });
  await app.register(import("./routes/graph"), { prefix: "/api" });
  await app.register(import("./routes/terminal"), { prefix: "/api" });
  await app.register(import("./routes/terminalWs"), { prefix: "/ws" });
  await app.register(import("./routes/mcp"), { prefix: "/mcp" });

  // Global error handler
  // Security headers
  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-XSS-Protection", "1; mode=block");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:3001 ws://127.0.0.1:3001 https://api.anthropic.com; img-src 'self' data:; font-src 'self' data:",
    );
  });

  app.setErrorHandler((error: Error & { validation?: unknown; statusCode?: number }, _request, reply) => {
    app.log.error(error);
    if (error.validation) {
      return reply.code(400).send({ error: "Validation error", details: error.validation });
    }
    const statusCode = error.statusCode || 500;
    const message = statusCode >= 500
      ? "Internal Server Error"
      : error.message || "Error";
    return reply.code(statusCode).send({ error: message });
  });

  // Cleanup on shutdown
  app.addHook("onClose", () => {
    closeDb();
  });

  return app;
}
