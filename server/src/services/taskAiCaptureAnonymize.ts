/**
 * Phase L: pure anonymizer helpers for task-AI capture replay payloads.
 * No DB, no FS, no spawn — these are easy to unit-test and reuse from the
 * harness when it inspects a captured payload.
 */

import { createHash } from "node:crypto";

/**
 * Normalize a path string by stripping `cwd` and any `extraPrefixes` from the
 * front and converting to forward slashes. Always returns a path relative to
 * the most-specific matching prefix; falls back to a placeholder when nothing
 * matches.
 */
export function scrubPath(p: string, cwd: string, extraPrefixes: string[] = []): string {
  if (!p) return p;
  const prefixes = [cwd, ...extraPrefixes].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (p === prefix) return ".";
    const withSep = prefix.endsWith("/") ? prefix : prefix + "/";
    if (p.startsWith(withSep)) return p.slice(withSep.length).replaceAll("\\", "/");
  }
  // Looks like an absolute path but matched no prefix — anonymize it entirely.
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return "<absolute>";
  return p.replaceAll("\\", "/");
}

const SECRET_PATTERNS: RegExp[] = [
  // env-style "KEY = value" or "KEY: value" or "KEY=value"
  /\b([A-Z][A-Z0-9_]{2,}(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|API|CREDENTIAL|AUTH|DSN))\s*[:=]\s*([^\s"',]+)/gi,
  // explicit DATABASE_URL pattern (postgres://user:pass@...) — separate so we
  // catch the value past the @ even if there's no key= prefix.
  /\b(?:postgres|mysql|mongodb|redis):\/\/[^:\s]+:[^@\s]+@\S+/gi,
  // bearer tokens in summary text
  /\b(Bearer|Token)\s+[A-Za-z0-9._-]{16,}/gi,
  // sk-/pk-prefixed keys (OpenAI/Anthropic-style); allow _ in the body
  /\b(sk|pk)[-_][A-Za-z0-9_]{16,}/gi,
];

const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Scrub secrets and identifiers from free-text. Returns a new string; original
 * not mutated. Targets:
 *   - env-style API keys / passwords (KEY=value, including DATABASE_URL)
 *   - bearer / sk- / pk- tokens
 *   - email addresses
 *   - UUIDs (often session IDs)
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const pat of SECRET_PATTERNS) {
    out = out.replace(pat, (match, p1) => {
      // For key=value patterns, keep the key name and redact the value.
      if (p1 && /^[A-Z]/.test(p1) && match.includes(p1)) {
        return `${p1}=<redacted>`;
      }
      return "<redacted>";
    });
  }
  out = out.replace(EMAIL_PATTERN, "<redacted-email>");
  out = out.replace(UUID_PATTERN, "<redacted-uuid>");
  return out;
}

/** Stable short hash of any identifier — used to anonymize project names and IDs. */
export function hashIdentifier(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

export interface AnonymizePayloadInput {
  cwd: string;
  projectPath: string;
  projectName: string;
  taskTitle: string;
  taskDescription: string | null;
  taskPrompt: string | null;
  taskMetadata: Record<string, unknown> | null;
  outcomeSummary: string | null;
}

export interface AnonymizedPayload {
  project: { nameHash: string };
  task: {
    title: string;
    description: string | null;
    prompt: string | null;
    metadata: Record<string, unknown> | null;
  };
  outcome: { summary: string | null };
}

/**
 * Convert raw capture inputs into an anonymized payload. Both project paths
 * and the system cwd are scrubbed from text fields; secrets/UUIDs/emails
 * redacted; project name is replaced by a short stable hash.
 */
export function anonymizePayload(input: AnonymizePayloadInput): AnonymizedPayload {
  const prefixes = [input.cwd, input.projectPath].filter(Boolean);
  const scrub = (s: string | null | undefined): string | null => {
    if (s == null) return s ?? null;
    let out = s;
    for (const prefix of prefixes) {
      if (!prefix) continue;
      out = out.split(prefix).join("<workdir>");
    }
    return redactSecrets(out);
  };
  return {
    project: { nameHash: hashIdentifier(input.projectName) },
    task: {
      title: scrub(input.taskTitle) ?? "",
      description: scrub(input.taskDescription),
      prompt: scrub(input.taskPrompt),
      metadata: input.taskMetadata,
    },
    outcome: { summary: scrub(input.outcomeSummary) },
  };
}

/** Truncate a string to N chars; preserves null. */
export function truncate(s: string | null, max: number): string | null {
  if (s == null) return s;
  if (s.length <= max) return s;
  return s.slice(0, max) + `…[+${s.length - max}]`;
}

export const SCHEMA_VERSION = 1;
