import type { FastifyPluginAsync } from "fastify";
import { log } from "../lib/logger";
import * as termService from "../services/terminalService";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3001",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:3001",
]);

const terminalWsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/terminal/:sessionId", { websocket: true }, (socket, request) => {
    const { sessionId } = request.params as { sessionId: string };

    // Origin check
    const origin = request.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      log("warn", "terminal", `Rejected WebSocket from origin: ${origin}`);
      socket.close(4003, "Forbidden origin");
      return;
    }

    // Attach WS to session
    const attached = termService.attachWs(sessionId, socket);
    if (!attached) {
      log("warn", "terminal", `WebSocket for unknown session: ${sessionId}`);
      socket.close(4004, "Session not found");
      return;
    }

    log("info", "terminal", `WebSocket connected for session: ${sessionId}`);

    socket.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
        switch (msg.type) {
          case "input":
            termService.writeToSession(sessionId, msg.data);
            break;

          case "resize":
            termService.resizeSession(sessionId, msg.cols, msg.rows);
            break;

          case "binary":
            termService.writeToSession(sessionId, msg.data);
            break;
        }
      } catch (err: any) {
        log("error", "terminal", `WS message error for ${sessionId}`, { error: err.message });
      }
    });

    socket.on("close", () => {
      log("info", "terminal", `WebSocket disconnected for session: ${sessionId}`);
      termService.detachWs(sessionId);
    });
  });
};

export default terminalWsRoutes;
