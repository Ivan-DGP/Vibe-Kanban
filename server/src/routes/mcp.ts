import { type FastifyPluginAsync } from "fastify";
import { tools, toolMap, type ToolContext } from "../mcp/tools";
import { registerClient, issueToken, validateToken, isAuthRequired } from "../mcp/auth";
import { getRunCwd } from "../services/runContext";
import { log } from "../lib/logger";

const mcpRoutes: FastifyPluginAsync = async (app) => {
  // Check if MCP is enabled
  function isMcpEnabled(): boolean {
    const { getDb } = require("../db");
    const db = getDb();
    const raw = db.query("SELECT value FROM settings WHERE key = 'mcpEnabled'").get() as any;
    if (!raw) return false;
    return JSON.parse(raw.value) === true;
  }

  // Validate tool-call arguments against the tool's inputSchema (required fields
  // present + correct primitive type). Returns an error string, or null if valid.
  function validateArgs(
    schema: Record<string, unknown>,
    args: Record<string, unknown>,
  ): string | null {
    const required = Array.isArray((schema as any).required)
      ? ((schema as any).required as string[])
      : [];
    const properties = ((schema as any).properties ?? {}) as Record<string, { type?: string }>;

    for (const field of required) {
      if (args[field] === undefined || args[field] === null) {
        return `Missing required parameter: ${field}`;
      }
    }

    for (const [key, val] of Object.entries(args)) {
      if (val === undefined || val === null) continue;
      const expected = properties[key]?.type;
      if (!expected) continue; // unknown property — leave to handler
      const ok =
        expected === "string"
          ? typeof val === "string"
          : expected === "number"
            ? typeof val === "number" && Number.isFinite(val)
            : expected === "boolean"
              ? typeof val === "boolean"
              : expected === "array"
                ? Array.isArray(val)
                : expected === "object"
                  ? typeof val === "object" && !Array.isArray(val)
                  : true;
      if (!ok) return `Invalid type for parameter '${key}': expected ${expected}`;
    }
    return null;
  }

  // Auth middleware
  function checkAuth(request: any): boolean {
    if (!isAuthRequired()) return true;
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return false;
    return validateToken(authHeader.slice(7));
  }

  // Shared JSON-RPC 2.0 dispatch. `ctx.cwd` is set for per-run endpoints so MCP
  // git tools operate on the run's worktree.
  async function handleRpc(
    body: {
      jsonrpc: string;
      method: string;
      params?: Record<string, unknown>;
      id?: string | number;
    },
    reply: any,
    ctx: ToolContext,
  ) {
    if (body.jsonrpc !== "2.0") {
      return reply.send({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid Request" },
        id: body.id ?? null,
      });
    }

    try {
      let result: unknown;

      switch (body.method) {
        case "initialize": {
          result = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "vibe-kanban", version: "1.3.0" },
          };
          break;
        }

        case "tools/list": {
          result = { tools: tools.map((t) => t.definition) };
          break;
        }

        case "tools/call": {
          const toolName = (body.params?.name ?? "") as string;
          const toolArgs = (body.params?.arguments ?? {}) as Record<string, unknown>;
          const tool = toolMap.get(toolName);

          if (!tool) {
            return reply.send({
              jsonrpc: "2.0",
              error: { code: -32601, message: `Unknown tool: ${toolName}` },
              id: body.id ?? null,
            });
          }

          const validationError = validateArgs(tool.definition.inputSchema, toolArgs);
          if (validationError) {
            return reply.send({
              jsonrpc: "2.0",
              error: { code: -32602, message: `Invalid params: ${validationError}` },
              id: body.id ?? null,
            });
          }

          const toolResult = await tool.handler(toolArgs, ctx);
          result = {
            content: [{ type: "text", text: JSON.stringify(toolResult) }],
          };
          log("info", "mcp", `Tool called: ${toolName}`);
          break;
        }

        default: {
          return reply.send({
            jsonrpc: "2.0",
            error: { code: -32601, message: `Unknown method: ${body.method}` },
            id: body.id ?? null,
          });
        }
      }

      return reply.send({ jsonrpc: "2.0", result, id: body.id ?? null });
    } catch (err: any) {
      // Log full detail server-side; return a generic message so DB schema/paths
      // don't leak to the client.
      log("error", "mcp", `Error handling ${body.method ?? "request"}`, {
        message: err?.message,
        stack: err?.stack,
      });
      return reply.send({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error" },
        id: body.id ?? null,
      });
    }
  }

  function sse(request: any, reply: any) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const serverInfo = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "vibe-kanban", version: "1.3.0" },
      },
    };
    reply.raw.write(`data: ${JSON.stringify(serverInfo)}\n\n`);
    const interval = setInterval(() => reply.raw.write(`: heartbeat\n\n`), 30000);
    request.raw.on("close", () => clearInterval(interval));
  }

  // JSON-RPC 2.0 handler (shared MCP endpoint — no per-run worktree context)
  app.post("/", async (request, reply) => {
    if (!isMcpEnabled()) return reply.code(404).send({ error: "MCP server is disabled" });
    if (!checkAuth(request)) return reply.code(401).send({ error: "Unauthorized" });
    return handleRpc(request.body as any, reply, {});
  });

  // Per-run endpoint — git tools resolve to this run's worktree cwd.
  app.post("/run/:runId", async (request, reply) => {
    if (!isMcpEnabled()) return reply.code(404).send({ error: "MCP server is disabled" });
    if (!checkAuth(request)) return reply.code(401).send({ error: "Unauthorized" });
    const { runId } = request.params as { runId: string };
    const cwd = getRunCwd(runId) ?? undefined;
    return handleRpc(request.body as any, reply, { cwd });
  });

  // SSE endpoints for MCP
  app.get("/", async (request, reply) => {
    if (!isMcpEnabled()) return reply.code(404).send({ error: "MCP server is disabled" });
    if (!checkAuth(request)) return reply.code(401).send({ error: "Unauthorized" });
    sse(request, reply);
  });

  app.get("/run/:runId", async (request, reply) => {
    if (!isMcpEnabled()) return reply.code(404).send({ error: "MCP server is disabled" });
    if (!checkAuth(request)) return reply.code(401).send({ error: "Unauthorized" });
    sse(request, reply);
  });

  // OAuth client registration — only when MCP is explicitly enabled.
  app.post("/oauth/register", async (request, reply) => {
    if (!isMcpEnabled()) {
      return reply.code(404).send({ error: "MCP server is disabled" });
    }
    const { redirect_uri } = (request.body ?? {}) as { redirect_uri?: unknown };
    if (typeof redirect_uri !== "string" || redirect_uri.length === 0) {
      return reply.code(400).send({ error: "redirect_uri required" });
    }
    // Reject malformed / non-http(s) redirect URIs.
    let parsed: URL;
    try {
      parsed = new URL(redirect_uri);
    } catch {
      return reply.code(400).send({ error: "Invalid redirect_uri" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return reply.code(400).send({ error: "Invalid redirect_uri" });
    }
    const client = registerClient(redirect_uri);
    return { client_id: client.clientId, client_secret: client.clientSecret };
  });

  // OAuth token endpoint — only when MCP is explicitly enabled.
  app.post("/oauth/token", async (request, reply) => {
    if (!isMcpEnabled()) {
      return reply.code(404).send({ error: "MCP server is disabled" });
    }
    const { client_id, client_secret } = (request.body ?? {}) as {
      client_id?: unknown;
      client_secret?: unknown;
    };
    if (typeof client_id !== "string" || typeof client_secret !== "string") {
      return reply.code(400).send({ error: "client_id and client_secret required" });
    }
    const token = issueToken(client_id, client_secret);
    if (!token) return reply.code(401).send({ error: "Invalid credentials" });
    return { access_token: token.accessToken, token_type: "bearer", expires_in: 3600 };
  });
};

export default mcpRoutes;
