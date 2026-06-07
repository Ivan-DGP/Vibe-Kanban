import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import path from "node:path";
import { getDb, closeDb } from "./db";
import { registerSpawnConfigs } from "./services/registerSpawnConfigs";
import { markOrphans as markOrphanBenchRuns } from "./services/benchRunsRepo";
import { markInterruptedRuns, cancelAllHeadlessRuns } from "./services/headlessClaude";

export async function buildApp(opts: { bodyLimit?: number } = {}) {
  const app = Fastify({ logger: true, bodyLimit: opts.bodyLimit });

  getDb();

  // bench_runs left 'running' across boot were killed mid-flight; mark failed before serving.
  markOrphanBenchRuns();
  // Same for task AI runs interrupted by a crash/restart.
  markInterruptedRuns();

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
  await app.register(import("./routes/knowledge"), { prefix: "/api" });
  await app.register(import("./routes/terminal"), { prefix: "/api" });
  await app.register(import("./routes/benchmarks"), { prefix: "/api" });
  await app.register(import("./routes/terminalWs"), { prefix: "/ws" });
  await app.register(import("./routes/mcp"), { prefix: "/mcp" });

  // Global error handler
  // Security headers
  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    // The legacy XSS auditor is deprecated and can itself introduce vulns; disable it.
    reply.header("X-XSS-Protection", "0");
    // script-src drops 'unsafe-inline' so an injected <script> cannot run; the
    // Vite build loads JS as external modules. style-src keeps 'unsafe-inline'
    // because Tailwind/inline styles require it.
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:3001 ws://127.0.0.1:3001 https://api.anthropic.com; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
  });

  app.setErrorHandler(
    (error: Error & { validation?: unknown; statusCode?: number }, _request, reply) => {
      app.log.error(error);
      if (error.validation) {
        return reply.code(400).send({ error: "Validation error", details: error.validation });
      }
      const statusCode = error.statusCode || 500;
      const message = statusCode >= 500 ? "Internal Server Error" : error.message || "Error";
      return reply.code(statusCode).send({ error: message });
    },
  );

  // Cleanup on shutdown
  app.addHook("onClose", () => {
    cancelAllHeadlessRuns();
    closeDb();
  });

  return app;
}
