/**
 * Origins the app's own frontend is served from. Used for CSRF defense on
 * state-changing/cross-origin-sensitive endpoints (api-client proxy) and for
 * the terminal WebSocket handshake. Matches the CORS allowlist in app.ts.
 */
const STATIC_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3001",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3001",
];

// Deploy-configured extra origins (comma-separated), e.g. the Tailscale URL
// the prod service is served from: VK_ALLOWED_ORIGINS=https://vps.tailXXXX.ts.net
const ENV_ORIGINS = (process.env.VK_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const ALLOWED_ORIGINS = new Set([...STATIC_ORIGINS, ...ENV_ORIGINS]);

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

// Hostname without the port — used for suffix matching (port breaks endsWith).
function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

// The app is deployed tailnet-only; Tailscale MagicDNS names live under *.ts.net.
function isTailnetOrigin(origin: string): boolean {
  const h = hostnameOf(origin);
  return !!h && (h === "ts.net" || h.endsWith(".ts.net"));
}

/**
 * Whether `origin` is allowed to reach cross-origin-sensitive endpoints.
 * Pass the request's Host header to also accept same-origin requests (covers
 * custom domains behind a reverse proxy). A browser sets Origin itself, so a
 * cross-site page cannot forge one — this stays safe against CSRF/WS hijack.
 */
export function isAllowedOrigin(origin: string | undefined | null, host?: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Same-origin as the request it rides on (proxy that preserves Host).
  if (host && hostOf(origin) === host) return true;
  // Tailscale-only deployment: trust tailnet MagicDNS origins.
  if (isTailnetOrigin(origin)) return true;
  return false;
}
