import type { Task } from "@vibe-kanban/shared";

export default function TaskViewerTimestamps({ task }: { task: Task }) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {task.inboxAt && <div>Inbox: {new Date(task.inboxAt).toLocaleString()}</div>}
      {task.inProgressAt && <div>In Progress: {new Date(task.inProgressAt).toLocaleString()}</div>}
      {task.doneAt && <div>Done: {new Date(task.doneAt).toLocaleString()}</div>}
    </div>
  );
}
