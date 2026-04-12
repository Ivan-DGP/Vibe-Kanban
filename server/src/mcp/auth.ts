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
  db.query(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
  ).run(`mcp_client_${clientId}`, JSON.stringify({ clientId, clientSecret, redirectUri, createdAt: now }));

  return { clientId, clientSecret, redirectUri, createdAt: now };
}

export function issueToken(clientId: string, clientSecret: string): OAuthToken | null {
  const db = getDb();
  const raw = db.query("SELECT value FROM settings WHERE key = ?").get(`mcp_client_${clientId}`) as any;
  if (!raw) return null;

  const client: OAuthClient = JSON.parse(raw.value);
  if (!safeCompare(client.clientSecret, clientSecret)) return null;

  const accessToken = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3600_000).toISOString();

  db.query(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
  ).run(`mcp_token_${accessToken}`, JSON.stringify({ accessToken, clientId, createdAt: now.toISOString(), expiresAt }));

  return { accessToken, clientId, createdAt: now.toISOString(), expiresAt };
}

export function validateToken(token: string): boolean {
  const db = getDb();
  const raw = db.query("SELECT value FROM settings WHERE key = ?").get(`mcp_token_${token}`) as any;
  if (!raw) return false;

  const t: OAuthToken = JSON.parse(raw.value);
  return new Date(t.expiresAt) > new Date();
}

export function isAuthRequired(): boolean {
  const db = getDb();
  const raw = db.query("SELECT value FROM settings WHERE key = 'mcpAuthRequired'").get() as any;
  if (!raw) return true; // Default: auth required
  return JSON.parse(raw.value) !== false;
}
