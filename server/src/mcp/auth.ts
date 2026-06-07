import { getDb } from "../db";
import { timingSafeEqual } from "node:crypto";

interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  createdAt: string;
}

interface OAuthToken {
  accessToken: string;
  clientId: string;
  createdAt: string;
  expiresAt: string;
}

export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function registerClient(redirectUri: string): OAuthClient {
  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID();
  const now = new Date().toISOString();

  const db = getDb();
  db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    `mcp_client_${clientId}`,
    JSON.stringify({ clientId, clientSecret, redirectUri, createdAt: now }),
  );

  return { clientId, clientSecret, redirectUri, createdAt: now };
}

// Delete expired token rows (prevents unbounded settings growth).
export function pruneExpiredTokens(): void {
  const db = getDb();
  const rows = db
    .query("SELECT key, value FROM settings WHERE key LIKE 'mcp_token_%'")
    .all() as any[];
  const nowMs = Date.now();
  for (const row of rows) {
    let expired = true;
    try {
      const t: OAuthToken = JSON.parse(row.value);
      expired = new Date(t.expiresAt).getTime() <= nowMs;
    } catch {
      // Unparseable row — treat as garbage and drop it
    }
    if (expired) db.query("DELETE FROM settings WHERE key = ?").run(row.key);
  }
}

export function issueToken(clientId: string, clientSecret: string): OAuthToken | null {
  const db = getDb();
  const raw = db
    .query("SELECT value FROM settings WHERE key = ?")
    .get(`mcp_client_${clientId}`) as any;
  if (!raw) return null;

  const client: OAuthClient = JSON.parse(raw.value);
  if (!safeCompare(client.clientSecret, clientSecret)) return null;

  pruneExpiredTokens();

  const accessToken = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3600_000).toISOString();

  db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    `mcp_token_${accessToken}`,
    JSON.stringify({ accessToken, clientId, createdAt: now.toISOString(), expiresAt }),
  );

  return { accessToken, clientId, createdAt: now.toISOString(), expiresAt };
}

export function validateToken(token: string): boolean {
  const db = getDb();
  const raw = db.query("SELECT value FROM settings WHERE key = ?").get(`mcp_token_${token}`) as any;
  if (!raw) return false;

  const t: OAuthToken = JSON.parse(raw.value);
  if (new Date(t.expiresAt) > new Date()) return true;

  // Expired — drop this row and sweep any other stale tokens
  db.query("DELETE FROM settings WHERE key = ?").run(`mcp_token_${token}`);
  pruneExpiredTokens();
  return false;
}

export function isAuthRequired(): boolean {
  const db = getDb();
  const raw = db.query("SELECT value FROM settings WHERE key = 'mcpAuthRequired'").get() as any;
  if (!raw) return true; // Default: auth required
  return JSON.parse(raw.value) !== false;
}
