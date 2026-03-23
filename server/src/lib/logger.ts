import type { LogLevel, LogCategory } from "@vibe-kanban/shared";
import { getDb } from "../db";

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
    ).run(
      level,
      category,
      message,
      details ? JSON.stringify(details) : null,
    );
  } catch {
    // Fallback to console if DB not ready
    console.error(`[${level}][${category}] ${message}`, details);
  }
}
