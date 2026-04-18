import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";
import * as termService from "../services/terminalService";
import { mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl: string;
let projectId: string;
const createdSessionIds: string[] = [];
const openWebSockets: WebSocket[] = [];
const testDir = `/tmp/terminal-ws-test-${Date.now()}`;

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true });

  app = await buildApp();
  // Start real HTTP server on random port for WebSocket tests
  await app.listen({ port: 0 });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  // Create a test project
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { "Content-Type": "application/json" },
    payload: { name: `WS Test Project ${Date.now()}`, path: testDir },
  });
  projectId = res.json().id;
});

afterAll(async () => {
  // Close all tracked WebSocket connections first
  for (const ws of openWebSockets) {
    try { if (ws.readyState <= WebSocket.OPEN) ws.close(); } catch {}
  }
  // Give WS close frames time to flush
  await new Promise((r) => setTimeout(r, 300));

  // Kill all terminal sessions (this also closes server-side WS)
  for (const id of createdSessionIds) {
    try { termService.killSession(id); } catch {}
  }
  for (const s of termService.listSessions()) {
    try { termService.killSession(s.id); } catch {}
  }

  await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });

  // Force-close the HTTP server to avoid hanging on lingering connections
  app.server.closeAllConnections();
  await app.close();
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
});

// Helper: create a terminal session via REST and return the id
async function createShellSession(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/terminal/sessions",
    headers: { "Content-Type": "application/json" },
    payload: { type: "shell", projectId, cols: 80, rows: 24, name: "ws-test-shell" },
  });
  const id = res.json().id;
  createdSessionIds.push(id);
  return id;
}

// Helper: open a WebSocket and wait for it to reach OPEN state
function connectWs(sessionId: string): Promise<WebSocket> {
  const wsUrl = baseUrl.replace("http", "ws") + `/ws/terminal/${sessionId}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    openWebSockets.push(ws);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", (e) => reject(e));
    // Timeout after 5s
    setTimeout(() => reject(new Error("WS open timeout")), 5000);
  });
}

// Helper: wait for the next message from the WebSocket
function _nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WS message timeout")), timeoutMs);
    ws.addEventListener("message", (event) => {
      clearTimeout(timer);
      resolve(JSON.parse(typeof event.data === "string" ? event.data : event.data.toString()));
    }, { once: true });
  });
}

// Helper: collect messages for a duration
function collectMessages(ws: WebSocket, durationMs: number): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = [];
    const handler = (event: MessageEvent) => {
      messages.push(JSON.parse(typeof event.data === "string" ? event.data : event.data.toString()));
    };
    ws.addEventListener("message", handler);
    setTimeout(() => {
      ws.removeEventListener("message", handler);
      resolve(messages);
    }, durationMs);
  });
}

// ---------------------------------------------------------------------------
// WebSocket connection and data flow
// ---------------------------------------------------------------------------

describe("WebSocket connection", () => {
  test("connects to an existing session and receives output", async () => {
    const sessionId = await createShellSession();
    const ws = await connectWs(sessionId);

    // The shell should emit some initial output (prompt, motd, etc.)
    // Send a simple echo command and check we get output back
    ws.send(JSON.stringify({ type: "input", data: "echo WS_TEST_MARKER\r" }));

    // Collect messages for up to 3 seconds
    const msgs = await collectMessages(ws, 3000);
    const outputMsgs = msgs.filter((m) => m.type === "output");

    // We should have received at least one output message
    expect(outputMsgs.length).toBeGreaterThanOrEqual(1);

    // At least one output should contain our marker
    const allOutput = outputMsgs.map((m) => m.data).join("");
    expect(allOutput).toContain("WS_TEST_MARKER");

    ws.close();
  });

  test("receives scrollback on reconnection", async () => {
    const sessionId = await createShellSession();

    // Connect first time and send a command
    const ws1 = await connectWs(sessionId);
    ws1.send(JSON.stringify({ type: "input", data: "echo RECONNECT_TEST_42\r" }));
    // Wait for output to be captured in scrollback
    await collectMessages(ws1, 2000);
    ws1.close();

    // Wait a beat for detach to process
    await new Promise((r) => setTimeout(r, 300));

    // Reconnect — should get scrollback containing previous output
    const ws2 = await connectWs(sessionId);
    const msgs = await collectMessages(ws2, 2000);
    const allOutput = msgs.filter((m) => m.type === "output").map((m) => m.data).join("");

    expect(allOutput).toContain("RECONNECT_TEST_42");

    ws2.close();
  });
});

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

describe("WebSocket input message types", () => {
  test("handles resize messages", async () => {
    const sessionId = await createShellSession();
    const ws = await connectWs(sessionId);

    // Send resize — should not crash or close the connection
    ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));

    // Verify connection stays alive by sending and receiving data
    ws.send(JSON.stringify({ type: "input", data: "echo RESIZE_OK\r" }));
    const msgs = await collectMessages(ws, 2000);
    const allOutput = msgs.filter((m) => m.type === "output").map((m) => m.data).join("");
    expect(allOutput).toContain("RESIZE_OK");

    ws.close();
  });

  test("handles binary message type", async () => {
    const sessionId = await createShellSession();
    const ws = await connectWs(sessionId);

    // Send binary type message (treated same as input)
    ws.send(JSON.stringify({ type: "binary", data: "echo BINARY_MSG\r" }));
    const msgs = await collectMessages(ws, 2000);
    const allOutput = msgs.filter((m) => m.type === "output").map((m) => m.data).join("");
    expect(allOutput).toContain("BINARY_MSG");

    ws.close();
  });

  test("handles malformed JSON gracefully (no crash)", async () => {
    const sessionId = await createShellSession();
    const ws = await connectWs(sessionId);

    // Send invalid JSON — should not crash the server
    ws.send("this is not json {{{");

    // Connection should still be alive
    ws.send(JSON.stringify({ type: "input", data: "echo AFTER_MALFORMED\r" }));
    const msgs = await collectMessages(ws, 2000);
    const allOutput = msgs.filter((m) => m.type === "output").map((m) => m.data).join("");
    expect(allOutput).toContain("AFTER_MALFORMED");

    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Non-existent / invalid session
// ---------------------------------------------------------------------------

describe("WebSocket to non-existent session", () => {
  test("closes with 4004 for unknown session", async () => {
    const wsUrl = baseUrl.replace("http", "ws") + "/ws/terminal/nonexistent-session-id";

    const result = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.addEventListener("close", (ev) => {
        resolve({ code: ev.code, reason: ev.reason });
      });
      ws.addEventListener("error", () => {
        // error before close is normal for rejected WS
      });
      setTimeout(() => reject(new Error("Timeout waiting for close")), 5000);
    });

    expect(result.code).toBe(4004);
    expect(result.reason).toBe("Session not found");
  });
});

// ---------------------------------------------------------------------------
// Origin check
// ---------------------------------------------------------------------------

describe("WebSocket origin validation", () => {
  test("rejects connections from disallowed origins with close code 4003", async () => {
    const sessionId = await createShellSession();
    const url = new URL(baseUrl);
    const port = parseInt(url.port);
    const host = url.hostname;
    const path = `/ws/terminal/${sessionId}`;
    // Use node:net to perform a raw WebSocket upgrade with a custom Origin header.
    // This is the only way to inject a custom Origin since the WebSocket constructor
    // does not support setting arbitrary headers.
    const net = require("node:net");

    // Sec-WebSocket-Key must be base64 of exactly 16 random bytes — the ws
    // library (via @fastify/websocket) rejects the upgrade at HTTP level
    // otherwise, so the handler's origin check would never run.
    const wsKey = randomBytes(16).toString("base64");
    const rawHandshake = [
      `GET ${path} HTTP/1.1`,
      `Host: ${host}:${port}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${wsKey}`,
      `Sec-WebSocket-Version: 13`,
      `Origin: http://evil.example.com`,
      ``,
      ``,
    ].join("\r\n");

    const closeResult = await new Promise<{ code: number } | "timeout">((resolve) => {
      const socket = net.connect(port, host, () => { socket.write(rawHandshake); });
      const chunks: Buffer[] = [];
      let resolved = false;

      const done = (val: { code: number } | "timeout") => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(val);
      };

      const timer = setTimeout(() => done("timeout"), 5000);

      function checkCloseFrame() {
        const buf = Buffer.concat(chunks);
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        if (!buf.toString("ascii", 0, headerEnd + 4).includes("101")) return;
        const wsData = buf.slice(headerEnd + 4);
        // Scan for close frame (opcode 0x88)
        for (let i = 0; i + 3 < wsData.length; i++) {
          const opcode = wsData[i] & 0x0f;
          const payloadLen = wsData[i + 1] & 0x7f;
          if (opcode === 0x8 && payloadLen >= 2) {
            const code = (wsData[i + 2] << 8) | wsData[i + 3];
            done({ code });
            return;
          }
        }
      }

      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        checkCloseFrame();
      });

      socket.on("error", () => done("timeout"));
      socket.on("close", () => {
        // Socket closed — must have received 101 and then a close frame from
        // the handler. If no 101 was received, the upgrade was rejected at
        // HTTP level (e.g. malformed key) — treat as failure so we don't
        // silently pass without exercising the handler.
        checkCloseFrame();
        if (!resolved) done("timeout");
      });
    });

    expect(closeResult).not.toBe("timeout");
    if (closeResult !== "timeout") {
      expect(closeResult.code).toBe(4003);
    }
  });

  test("allows connections from allowed localhost origins", async () => {
    const sessionId = await createShellSession();
    // Bun's WebSocket constructor sends no Origin header by default,
    // which the handler treats as allowed (origin is falsy → passes check).
    const ws = await connectWs(sessionId);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Disconnect handling
// ---------------------------------------------------------------------------

describe("WebSocket disconnect", () => {
  test("detaches WS on close without killing the session", async () => {
    const sessionId = await createShellSession();
    const ws = await connectWs(sessionId);

    // Close the WS
    ws.close();
    await new Promise((r) => setTimeout(r, 500));

    // Session should still exist (alive) even though WS disconnected
    const session = termService.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session!.alive).toBe(true);
    expect(session!.ws).toBeNull();
  });
});
