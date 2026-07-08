import type { FastifyPluginAsync } from "fastify";
import { log } from "../lib/logger";
import * as termService from "../services/terminalService";
import { isAllowedOrigin } from "../lib/origin";

// Terminal dimensions must be positive bounded integers.
function isValidDimension(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 1000;
}

const terminalWsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/terminal/:sessionId", { websocket: true }, (socket, request) => {
    const { sessionId } = request.params as { sessionId: string };

    // Origin check: reject when Origin is missing OR not an allowed app origin.
    // Browsers always send Origin, so the legit client is unaffected; this
    // blocks non-browser clients (which omit Origin) from attaching.
    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin, request.headers.host)) {
      log("warn", "terminal", `Rejected WebSocket from origin: ${origin ?? "<missing>"}`);
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
          case "binary":
            // Only write string payloads to the PTY.
            if (typeof msg.data === "string") {
              termService.writeToSession(sessionId, msg.data);
            }
            break;

          case "resize":
            // Validate cols/rows are positive bounded integers before resizing.
            if (isValidDimension(msg.cols) && isValidDimension(msg.rows)) {
              termService.resizeSession(sessionId, msg.cols, msg.rows);
            }
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
