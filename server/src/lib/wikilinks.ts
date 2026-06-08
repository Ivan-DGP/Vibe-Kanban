/**
 * Pure helpers for Obsidian-style [[wikilink]] parsing and slug derivation.
 * No DB / IO here — kept side-effect free so it is trivially unit-testable.
 */

const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;

/**
 * Extract raw [[target]] references from markdown. Supports [[target]] and
 * [[target|alias]] (alias dropped — only the target is link-relevant). Code
 * fences (``` … ```) and inline code (`…`) are stripped first so links inside
 * code samples are ignored. Targets are trimmed; duplicates are de-duped while
 * preserving first-seen order. Empty targets are skipped.
 */
export function parseWikilinks(markdown: string): string[] {
  if (!markdown) return [];
  const stripped = stripCode(markdown);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of stripped.matchAll(WIKILINK_RE)) {
    const inner = match[1];
    // [[target|alias]] → keep target only; [[target#heading]] → keep target.
    const target = inner.split("|")[0].split("#")[0].trim();
    if (!target) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    out.push(target);
  }
  return out;
}

function stripCode(md: string): string {
  // Drop fenced blocks first, then inline code spans.
  return md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/**
 * Deterministic slug for matching a [[target]] against an artifact filename:
 * strip a single trailing extension, lowercase, collapse whitespace to single
 * hyphens, trim leading/trailing hyphens. e.g. "My Spec.md" → "my-spec".
 */
export function slugify(value: string): string {
  const noExt = value.replace(/\.[^./\\]+$/, "");
  return noExt
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A target is "escaping" — i.e. it tries to express a filesystem path rather
 * than a plain artifact name — if it contains a path separator or a parent
 * traversal segment. Such targets must NEVER be resolved to a file; they are
 * recorded as unresolved (pending-links) instead.
 */
export function isEscapingTarget(rawTarget: string): boolean {
  const t = rawTarget.trim();
  if (t.includes("/") || t.includes("\\")) return true;
  if (t.includes("..")) return true;
  return false;
}
