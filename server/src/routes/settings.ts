import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { encrypt, tryDecrypt } from "../lib/crypto";

const SENSITIVE_KEY_PREFIXES = ["mcp_client_", "mcp_token_"];
// Encrypted at rest; redacted in GET/PUT responses.
const REDACTED_KEYS = new Set(["claudeApiKey", "notionApiKey"]);
const ENCRYPTED_KEYS = REDACTED_KEYS;
const WRITABLE_KEYS = new Set([
  "claudeApiKey",
  "notionApiKey",
  "mcpEnabled",
  "mcpAuthRequired",
  "soundEnabled",
  "terminalShell",
]);

function readSettings(db: any, redact = true): Record<string, unknown> {
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    if (SENSITIVE_KEY_PREFIXES.some((p) => row.key.startsWith(p))) continue;
    try {
      let parsed = JSON.parse(row.value);
      if (ENCRYPTED_KEYS.has(row.key) && typeof parsed === "string" && parsed) {
        // Decrypt; legacy plaintext (undecryptable) falls back to the stored value.
        parsed = tryDecrypt(parsed) ?? parsed;
      }
      if (redact && REDACTED_KEYS.has(row.key)) {
        settings[row.key] = parsed ? "••••••••" : null;
      } else {
        settings[row.key] = parsed;
      }
    } catch {
      settings[row.key] = row.value;
    }
  }
  return settings;
}

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  fastify.get("/settings", async () => {
    return readSettings(db);
  });

  fastify.put("/settings", async (request, _reply) => {
    const updates = request.body as Record<string, unknown>;
    const ts = new Date().toISOString();

    db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        if (!WRITABLE_KEYS.has(key)) continue;
        const toStore =
          ENCRYPTED_KEYS.has(key) && typeof value === "string" && value ? encrypt(value) : value;
        const serialized = JSON.stringify(toStore);
        db.prepare(
          `INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
        ).run(key, serialized, ts);
      }
    })();

    return readSettings(db);
  });
};

export default settingsRoutes;
