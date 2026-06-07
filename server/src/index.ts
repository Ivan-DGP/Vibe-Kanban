import { buildApp } from "./app";

const PORT = parseInt(process.env.PORT || "3001", 10);

// Prevent PTY "Socket is closed" / stream errors from crashing the process.
// These happen when xterm.js sends input (e.g. focus-in \x1b[O) after a PTY
// has been killed. The per-call try/catch in the WS handler catches most cases,
// but Bun's EventEmitter dispatch can re-throw async errors past a try/catch.
process.on("uncaughtException", (err: Error) => {
  const msg = err?.message ?? String(err);
  if (
    msg.includes("Socket is closed") ||
    msg.includes("ERR_SOCKET_CLOSED") ||
    msg.includes("AttachConsole")
  ) {
    console.warn(`[terminal] Suppressed non-fatal PTY error: ${msg}`);
    return;
  }
  // Re-throw everything else so real bugs aren't silenced
  console.error("Uncaught exception:", err);
  process.exit(1);
});

async function main() {
  const app = await buildApp();
  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`Vibe Kanban server listening on http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
