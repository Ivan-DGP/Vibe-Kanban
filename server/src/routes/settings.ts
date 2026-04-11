import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";

const SENSITIVE_KEY_PREFIXES = ["mcp_client_", "mcp_token_"];
const REDACTED_KEYS = new Set(["claudeApiKey", "notionApiKey"]);
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
      const parsed = JSON.parse(row.value);
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
        const serialized = JSON.stringify(value);
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
