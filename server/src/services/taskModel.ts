import type { Task, TaskStatus } from "@vibe-kanban/shared";

// Task domain logic shared by the task routes, the Notion sync, and the MCP
// tools. Lives in services/ (not in routes/tasks.ts) so it isn't an accidental
// cross-layer import — routes and mcp both depend on it, never on each other.

function now(): string {
  return new Date().toISOString();
}

/**
 * Map a raw `tasks` DB row to the API/UI `Task` shape. Explicit field mapping
 * (not a `{...row}` spread) so a DB-schema ↔ wire-contract drift fails `tsc`
 * instead of silently shipping a malformed row. `metadata` is stored as a JSON
 * string; a null/absent row passes through unchanged (callers 404 first).
 */
export function rowToTask(row: Record<string, unknown> | null | undefined): Task {
  if (!row) return row as unknown as Task;
  return {
    id: row.id as string,
    projectId: row.projectId as string,
    milestoneId: (row.milestoneId ?? null) as string | null,
    parentTaskId: (row.parentTaskId ?? null) as string | null,
    title: row.title as string,
    description: (row.description ?? null) as string | null,
    prompt: (row.prompt ?? null) as string | null,
    branch: (row.branch ?? null) as string | null,
    promptProfile: row.promptProfile as Task["promptProfile"],
    status: row.status as TaskStatus,
    priority: row.priority as Task["priority"],
    taskNumber: row.taskNumber as number,
    sortOrder: row.sortOrder as number,
    inboxAt: (row.inboxAt ?? null) as string | null,
    inProgressAt: (row.inProgressAt ?? null) as string | null,
    doneAt: (row.doneAt ?? null) as string | null,
    approvedAt: (row.approvedAt ?? null) as string | null,
    archivedAt: (row.archivedAt ?? null) as string | null,
    notionPageId: (row.notionPageId ?? null) as string | null,
    metadata: row.metadata ? (JSON.parse(row.metadata as string) as Record<string, unknown>) : {},
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

/**
 * Timestamp cascade: when a task enters a status, backfill any earlier
 * lifecycle timestamps that were never set — never removes. See CLAUDE.md.
 */
export function applyTimestampCascade(
  task: Partial<Task>,
  newStatus: TaskStatus,
): Record<string, string> {
  const ts = now();
  const updates: Record<string, string> = { updatedAt: ts };

  if (newStatus === "backlog" || newStatus === "todo") {
    if (!task.inboxAt) updates.inboxAt = ts;
  }
  if (newStatus === "in_progress") {
    if (!task.inboxAt) updates.inboxAt = ts;
    if (!task.inProgressAt) updates.inProgressAt = ts;
  }
  if (newStatus === "done") {
    if (!task.inboxAt) updates.inboxAt = ts;
    if (!task.inProgressAt) updates.inProgressAt = ts;
    if (!task.doneAt) updates.doneAt = ts;
  }
  if (newStatus === "approved") {
    if (!task.inboxAt) updates.inboxAt = ts;
    if (!task.inProgressAt) updates.inProgressAt = ts;
    if (!task.doneAt) updates.doneAt = ts;
    if (!task.approvedAt) updates.approvedAt = ts;
  }
  if (newStatus === "archived") {
    if (!task.inboxAt) updates.inboxAt = ts;
    if (!task.inProgressAt) updates.inProgressAt = ts;
    if (!task.doneAt) updates.doneAt = ts;
    if (!task.approvedAt) updates.approvedAt = ts;
    if (!task.archivedAt) updates.archivedAt = ts;
  }

  return updates;
}
