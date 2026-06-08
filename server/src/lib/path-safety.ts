import path from "node:path";
import fs from "node:fs";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function assertUuid(value: unknown, label = "id"): string {
  if (!isUuid(value)) throw new PathSafetyError(`Invalid ${label}`);
  return value as string;
}

/**
 * A value safe to use as a single filesystem path segment: no separators, no
 * "."/".." , no control chars. Fully blocks `../` traversal while still allowing
 * UUIDs and other generated ids (more backward-compatible than requiring a UUID).
 */
export function isSafeSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

export function assertSafeSegment(value: unknown, label = "id"): string {
  if (!isSafeSegment(value)) throw new PathSafetyError(`Invalid ${label}`);
  return value as string;
}

/**
 * realpath that tolerates a not-yet-existing leaf (e.g. file creation): walks up
 * to the nearest existing ancestor, canonicalizes it (resolving any symlinks),
 * then re-appends the missing trailing segments. This means a symlinked ancestor
 * pointing outside the base is caught by the boundary check below.
 */
function realpathAllowingMissing(target: string): string {
  let current = path.resolve(target);
  const missing: string[] = [];
  // Bounded by path depth.
  for (let i = 0; i < 4096; i++) {
    try {
      const real = fs.realpathSync(current);
      return missing.length ? path.join(real, ...missing.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target; // reached root, nothing existed
      missing.push(path.basename(current));
      current = parent;
    }
  }
  return target;
}

/**
 * Resolve `userPath` against `baseDir` and guarantee the result stays within
 * baseDir even after symlink resolution. Throws PathSafetyError on escape.
 *
 * Replaces fragile `resolved.startsWith(base)` checks, which admit sibling
 * directories (e.g. `/p` vs `/p-secret`) and follow symlinks out of the tree.
 */
export function resolveWithin(baseDir: string, userPath: string): string {
  const base = realpathAllowingMissing(path.resolve(baseDir));
  const resolved = realpathAllowingMissing(path.resolve(base, userPath ?? ""));
  const rel = path.relative(base, resolved);
  if (rel === "") return resolved; // base itself
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new PathSafetyError("Path escapes the allowed directory");
  }
  return resolved;
}

export function isWithin(baseDir: string, userPath: string): boolean {
  try {
    resolveWithin(baseDir, userPath);
    return true;
  } catch {
    return false;
  }
}
