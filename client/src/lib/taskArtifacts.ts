import type { Task, TaskArtifactRef } from "@vibe-kanban/shared";

/** Read the artifact refs a task carries in metadata.artifacts (see attach_artifact_to_task). */
export function getTaskArtifacts(task: Pick<Task, "metadata">): TaskArtifactRef[] {
  const md = task.metadata as Record<string, unknown> | undefined;
  const arts = md?.artifacts;
  if (!Array.isArray(arts)) return [];
  return arts.filter(
    (a): a is TaskArtifactRef =>
      !!a && typeof a === "object" && typeof (a as { id?: unknown }).id === "string",
  );
}

/** The id of the task's quiz artifact (role 'quiz'), or null if none is attached. */
export function getQuizArtifactId(task: Pick<Task, "metadata">): string | null {
  return getTaskArtifacts(task).find((a) => a.role === "quiz")?.id ?? null;
}

/** Whether the task's comprehension quiz has been marked passed (metadata.quizPassed). */
export function isQuizPassed(task: Pick<Task, "metadata">): boolean {
  return (task.metadata as Record<string, unknown> | undefined)?.quizPassed === true;
}

/**
 * True when moving this task to `approved` should surface the quiz gate: it has
 * a quiz artifact attached and hasn't been marked passed yet. Soft gate — the
 * user can still override in the dialog.
 */
export function shouldGateApproval(task: Pick<Task, "metadata">): boolean {
  return getQuizArtifactId(task) !== null && !isQuizPassed(task);
}
