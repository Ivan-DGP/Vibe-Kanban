/**
 * Reads Claude Code's UNDOCUMENTED statusline usage cache to recover the
 * usage-limit reset time for auto-resume scheduling.
 *
 * This is an UNSUPPORTED INTERNAL of the Claude CLI — best-effort only. Any
 * failure (dir/file missing, malformed JSON, key drift) returns null, and the
 * resume scheduler falls back to a fixed polling interval. This module is the
 * SINGLE place that knows the cache's shape; keep the key-drift tolerance here.
 *
 * Path: `<TEMP|tmpdir>/claude/statusline-usage-cache-*.json`
 */
import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function readUsageResetFromCache(): Date | null {
  try {
    const dir = path.join(process.env.TEMP ?? os.tmpdir(), "claude");
    const file = readdirSync(dir).find((n) => n.startsWith("statusline-usage-cache-"));
    if (!file) return null;
    const j = JSON.parse(readFileSync(path.join(dir, file), "utf-8"));
    // Tolerate key drift across CLI versions.
    const iso = j?.five_hour?.resets_at ?? j?.resetsAt ?? j?.reset_at ?? null;
    if (typeof iso !== "string" && typeof iso !== "number") return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
