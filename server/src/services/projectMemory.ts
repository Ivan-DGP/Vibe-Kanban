import { getDb } from "../db";
import { embedMemoryInBackground } from "./memoryEmbedder";
import type { ProjectMemoryEvent, CreateMemoryInput, MemoryQuery } from "@vibe-kanban/shared";

// Raw DB row: `files` is stored as a JSON string; everything else maps directly.
interface MemoryRow {
  id: string;
  projectId: string;
  type: ProjectMemoryEvent["type"];
  title: string;
  body: string;
  files: string;
  taskId: string | null;
  runId: string | null;
  origin: ProjectMemoryEvent["origin"];
  supersededBy: string | null;
  createdAt: string;
}

function rowToEvent(row: MemoryRow): ProjectMemoryEvent {
  let files: string[] = [];
  try {
    const parsed = JSON.parse(row.files || "[]");
    if (Array.isArray(parsed)) files = parsed as string[];
  } catch {
    files = [];
  }
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    title: row.title,
    body: row.body,
    files,
    taskId: row.taskId,
    runId: row.runId,
    origin: row.origin,
    supersededBy: row.supersededBy,
    createdAt: row.createdAt,
  };
}

/**
 * Append a memory event (append-only — never updates an existing row) and kick
 * off background embedding. Returns the persisted event. `origin` defaults to
 * `ai_captured`; `files`/`body` default to empty.
 */
export function appendMemory(input: CreateMemoryInput): ProjectMemoryEvent {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const body = input.body ?? "";
  const files = input.files ?? [];
  const origin = input.origin ?? "ai_captured";

  db.prepare(
    `INSERT INTO project_memory (id, projectId, type, title, body, files, taskId, runId, origin, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.type,
    input.title,
    body,
    JSON.stringify(files),
    input.taskId ?? null,
    input.runId ?? null,
    origin,
    now,
  );

  embedMemoryInBackground({
    projectId: input.projectId,
    memoryId: id,
    type: input.type,
    title: input.title,
    body,
    files,
  });

  return getMemory(id)!;
}

/** Retire `oldId` by pointing it at a later event `newId` (append-only; the old
 * row is kept, only its `supersededBy` pointer is set). Returns the updated old
 * event, or null if it does not exist. */
export function supersede(oldId: string, newId: string): ProjectMemoryEvent | null {
  // Defense-in-depth: a self-loop (oldId === newId) would break any supersededBy
  // chain traversal. The route also guards this, but later callers (auto-capture,
  // MCP) hit the service directly, so reject it here too.
  if (oldId === newId) return null;
  const db = getDb();
  const res = db
    .prepare("UPDATE project_memory SET supersededBy = ? WHERE id = ?")
    .run(newId, oldId);
  if (res.changes === 0) return null;
  return getMemory(oldId);
}

export function getMemory(id: string): ProjectMemoryEvent | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM project_memory WHERE id = ?").get(id) as
    | MemoryRow
    | undefined;
  return row ? rowToEvent(row) : null;
}

/** List a project's memory timeline, newest first. Excludes superseded entries
 * by default. */
export function listMemory(projectId: string, query: MemoryQuery = {}): ProjectMemoryEvent[] {
  const db = getDb();
  const clauses = ["projectId = ?"];
  const binds: unknown[] = [projectId];
  if (query.type) {
    clauses.push("type = ?");
    binds.push(query.type);
  }
  if (!query.includeSuperseded) {
    clauses.push("supersededBy IS NULL");
  }
  // Guard against a non-numeric limit reaching SQL as NaN (nullish `??` does not
  // catch NaN) — that would bind a NaN LIMIT and throw SQLITE_MISMATCH.
  const limit = Math.min(
    Math.max(Number.isFinite(query.limit) ? (query.limit as number) : 100, 1),
    500,
  );
  const rows = db
    .prepare(
      `SELECT * FROM project_memory WHERE ${clauses.join(" AND ")} ORDER BY createdAt DESC LIMIT ?`,
    )
    .all(...binds, limit) as MemoryRow[];
  return rows.map(rowToEvent);
}
