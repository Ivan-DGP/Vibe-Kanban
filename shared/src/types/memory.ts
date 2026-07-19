// ============================================================
// Project Memory — append-only typed long-term context
// ============================================================

/** The kind of a memory event. Mirrors the DB CHECK constraint (migration 40). */
export type MemoryType = "decision" | "gotcha" | "attempt_failed" | "convention" | "fragile_file";

/** Who authored a memory event. `ai_captured` = derived from an AI run; `human`
 * = written or promoted/curated by a person. */
export type MemoryOrigin = "human" | "ai_captured";

/** One row of `project_memory`. Append-only: an entry is retired by pointing a
 * later entry at it via `supersededBy` (never hard-updated). */
export interface ProjectMemoryEvent {
  id: string;
  projectId: string;
  type: MemoryType;
  title: string;
  body: string;
  /** Affected repo-relative paths; may be empty. */
  files: string[];
  /** Provenance: the task/run this was captured from, if any. */
  taskId: string | null;
  runId: string | null;
  origin: MemoryOrigin;
  /** Id of a later event that replaces this one, or null if still current. */
  supersededBy: string | null;
  createdAt: string;
}

/** Input to append a new memory event. `origin` defaults to `ai_captured` at the
 * service layer; `files` defaults to `[]`. */
export interface CreateMemoryInput {
  projectId: string;
  type: MemoryType;
  title: string;
  body?: string;
  files?: string[];
  taskId?: string | null;
  runId?: string | null;
  origin?: MemoryOrigin;
}

/** Filters for listing a project's memory timeline. */
export interface MemoryQuery {
  type?: MemoryType;
  /** Include entries that have been superseded (default: exclude). */
  includeSuperseded?: boolean;
  limit?: number;
}

/** A memory event that grounded a spawn prompt (injected into <project_memory>),
 * recorded for audit. Mirrors GroundedArtifact. */
export interface GroundedMemory {
  id: string;
  title: string;
  type: MemoryType;
}
