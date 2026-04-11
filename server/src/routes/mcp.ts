import { type FastifyPluginAsync } from "fastify";
import { tools, toolMap } from "../mcp/tools";
import { registerClient, issueToken, validateToken, isAuthRequired } from "../mcp/auth";
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

  // Auth middleware
  function checkAuth(request: any): boolean {
    if (!isAuthRequired()) return true;
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return false;
    return validateToken(authHeader.slice(7));
  }

  // JSON-RPC 2.0 handler
  app.post("/", async (request, reply) => {
    if (!isMcpEnabled()) {
      return reply.code(404).send({ error: "MCP server is disabled" });
    }
    if (!checkAuth(request)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const body = request.body as {
      jsonrpc: string;
      method: string;
      params?: Record<string, unknown>;
      id?: string | number;
    };

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

          const toolResult = await tool.handler(toolArgs);
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
      log("error", "mcp", `Error handling request: ${err.message}`);
      return reply.send({
        jsonrpc: "2.0",
        error: { code: -32603, message: err.message },
        id: body.id ?? null,
      });
    }
  });

  // SSE endpoint for MCP
  app.get("/", async (request, reply) => {
    if (!isMcpEnabled()) {
      return reply.code(404).send({ error: "MCP server is disabled" });
    }
    if (!checkAuth(request)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // Send server info
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

    // Keep-alive
    const interval = setInterval(() => {
      reply.raw.write(`: heartbeat\n\n`);
    }, 30000);

    request.raw.on("close", () => {
      clearInterval(interval);
    });
  });

  // OAuth client registration
  app.post("/oauth/register", async (request, reply) => {
    const { redirect_uri } = request.body as { redirect_uri: string };
    if (!redirect_uri) return reply.code(400).send({ error: "redirect_uri required" });
    const client = registerClient(redirect_uri);
    return { client_id: client.clientId, client_secret: client.clientSecret };
  });

  // OAuth token endpoint
  app.post("/oauth/token", async (request, reply) => {
    const { client_id, client_secret } = request.body as { client_id: string; client_secret: string };
    const token = issueToken(client_id, client_secret);
    if (!token) return reply.code(401).send({ error: "Invalid credentials" });
    return { access_token: token.accessToken, token_type: "bearer", expires_in: 3600 };
  });
};

export default mcpRoutes;
