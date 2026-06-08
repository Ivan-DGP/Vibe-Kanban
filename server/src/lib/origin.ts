/**
 * Origins the app's own frontend is served from. Used for CSRF defense on
 * state-changing/cross-origin-sensitive endpoints (api-client proxy) and for
 * the terminal WebSocket handshake. Matches the CORS allowlist in app.ts.
 */
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:3001",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3001",
]);

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin);
}
