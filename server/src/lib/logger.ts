import type { LogLevel, LogCategory } from "@vibe-kanban/shared";
import { getDb } from "../db";

const SENSITIVE_KEY = /token|secret|password|apikey|api_key|authorization|cookie|bearer/i;

// Recursively replace values for sensitive keys with '[REDACTED]' before persisting.
function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    return value.map((v) => redactSecrets(v, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value as object)) return value;
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redactSecrets(v, seen);
    }
    return out;
  }
  return value;
}

export function log(
  level: LogLevel,
  category: LogCategory,
  message: string,
  details?: unknown,
): void {
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO system_logs (level, category, message, details) VALUES (?, ?, ?, ?)",
    ).run(level, category, message, details ? JSON.stringify(redactSecrets(details)) : null);
  } catch {
    // Fallback to console if DB not ready
    console.error(`[${level}][${category}] ${message}`, details);
  }
}
