import { describe, test, expect, afterAll } from "bun:test";
import { getDb } from "../db";
import { registerClient, issueToken, validateToken, isAuthRequired, safeCompare } from "./auth";

// Track keys we insert so we can clean up
const settingsKeysToClean: string[] = [];

afterAll(() => {
  const db = getDb();
  for (const key of settingsKeysToClean) {
    db.query("DELETE FROM settings WHERE key = ?").run(key);
  }
});

function trackClient(clientId: string) {
  settingsKeysToClean.push(`mcp_client_${clientId}`);
}

function trackToken(accessToken: string) {
  settingsKeysToClean.push(`mcp_token_${accessToken}`);
}

describe("registerClient", () => {
  test("returns { clientId, clientSecret, redirectUri, createdAt }, all fields are non-empty strings", () => {
    const result = registerClient("http://localhost:3000/callback");
    trackClient(result.clientId);

    expect(typeof result.clientId).toBe("string");
    expect(typeof result.clientSecret).toBe("string");
    expect(typeof result.redirectUri).toBe("string");
    expect(typeof result.createdAt).toBe("string");

    expect(result.clientId.length).toBeGreaterThan(0);
    expect(result.clientSecret.length).toBeGreaterThan(0);
    expect(result.redirectUri.length).toBeGreaterThan(0);
    expect(result.createdAt.length).toBeGreaterThan(0);

    expect(result.redirectUri).toBe("http://localhost:3000/callback");
  });

  test("calling twice returns different clientId/clientSecret", () => {
    const first = registerClient("http://localhost:3000/cb1");
    const second = registerClient("http://localhost:3000/cb2");
    trackClient(first.clientId);
    trackClient(second.clientId);

    expect(first.clientId).not.toBe(second.clientId);
    expect(first.clientSecret).not.toBe(second.clientSecret);
  });
});

describe("issueToken", () => {
  test("with valid clientId + clientSecret returns { accessToken, clientId, createdAt, expiresAt }", () => {
    const client = registerClient("http://localhost:3000/callback");
    trackClient(client.clientId);

    const token = issueToken(client.clientId, client.clientSecret);
    expect(token).not.toBeNull();
    trackToken(token!.accessToken);

    expect(typeof token!.accessToken).toBe("string");
    expect(token!.accessToken.length).toBeGreaterThan(0);
    expect(token!.clientId).toBe(client.clientId);
    expect(typeof token!.createdAt).toBe("string");
    expect(token!.createdAt.length).toBeGreaterThan(0);
    expect(typeof token!.expiresAt).toBe("string");
    expect(token!.expiresAt.length).toBeGreaterThan(0);

    // expiresAt should be in the future
    expect(new Date(token!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("with wrong clientSecret returns null", () => {
    const client = registerClient("http://localhost:3000/callback");
    trackClient(client.clientId);

    const token = issueToken(client.clientId, "wrong-secret");
    expect(token).toBeNull();
  });

  test("with non-existent clientId returns null", () => {
    const token = issueToken("non-existent-client-id", "any-secret");
    expect(token).toBeNull();
  });
});

describe("validateToken", () => {
  test("valid token returns true", () => {
    const client = registerClient("http://localhost:3000/callback");
    trackClient(client.clientId);

    const token = issueToken(client.clientId, client.clientSecret);
    expect(token).not.toBeNull();
    trackToken(token!.accessToken);

    expect(validateToken(token!.accessToken)).toBe(true);
  });

  test("non-existent token returns false", () => {
    expect(validateToken("non-existent-token-abc123")).toBe(false);
  });

  test("expired token returns false", () => {
    const client = registerClient("http://localhost:3000/callback");
    trackClient(client.clientId);

    const token = issueToken(client.clientId, client.clientSecret);
    expect(token).not.toBeNull();
    trackToken(token!.accessToken);

    // Manipulate the DB to set expiresAt in the past
    const db = getDb();
    const pastDate = new Date(Date.now() - 3600_000).toISOString();
    const storedData = JSON.parse(
      (
        db
          .query("SELECT value FROM settings WHERE key = ?")
          .get(`mcp_token_${token!.accessToken}`) as any
      ).value,
    );
    storedData.expiresAt = pastDate;
    db.query("UPDATE settings SET value = ? WHERE key = ?").run(
      JSON.stringify(storedData),
      `mcp_token_${token!.accessToken}`,
    );

    expect(validateToken(token!.accessToken)).toBe(false);
  });
});

describe("isAuthRequired", () => {
  const AUTH_SETTING_KEY = "mcpAuthRequired";

  afterAll(() => {
    // Clean up the auth setting after these tests
    const db = getDb();
    db.query("DELETE FROM settings WHERE key = ?").run(AUTH_SETTING_KEY);
  });

  test("returns true by default (no setting in DB)", () => {
    const db = getDb();
    // Ensure no setting exists
    db.query("DELETE FROM settings WHERE key = ?").run(AUTH_SETTING_KEY);

    expect(isAuthRequired()).toBe(true);
  });

  test("returns false when setting exists with value false", () => {
    const db = getDb();
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      AUTH_SETTING_KEY,
      JSON.stringify(false),
    );

    expect(isAuthRequired()).toBe(false);

    // Clean up
    db.query("DELETE FROM settings WHERE key = ?").run(AUTH_SETTING_KEY);
  });

  test("returns true when setting exists with explicit value true", () => {
    const db = getDb();
    db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      AUTH_SETTING_KEY,
      JSON.stringify(true),
    );

    expect(isAuthRequired()).toBe(true);

    // Clean up
    db.query("DELETE FROM settings WHERE key = ?").run(AUTH_SETTING_KEY);
  });
});

describe("safeCompare", () => {
  test("equal strings return true", () => {
    expect(safeCompare("hello", "hello")).toBe(true);
    expect(safeCompare("abc123", "abc123")).toBe(true);
    expect(safeCompare("", "")).toBe(true);
  });

  test("different strings return false", () => {
    expect(safeCompare("hello", "world")).toBe(false);
    expect(safeCompare("abc", "abd")).toBe(false);
  });

  test("different lengths return false", () => {
    expect(safeCompare("short", "much longer string")).toBe(false);
    expect(safeCompare("abc", "ab")).toBe(false);
    expect(safeCompare("a", "aa")).toBe(false);
  });
});
