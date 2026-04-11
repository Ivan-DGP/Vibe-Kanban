import type { Task } from "@vibe-kanban/shared";

export function tasksToCSV(tasks: Task[]): string {
  const headers = ["title", "status", "priority", "description", "milestoneId", "createdAt", "doneAt"];
  const rows = tasks.map((t) =>
    headers.map((h) => {
      const val = t[h as keyof Task];
      const str = val == null ? "" : String(val);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

export function tasksToJSON(tasks: Task[]): string {
  return JSON.stringify(tasks, null, 2);
}

export function tasksToMarkdown(tasks: Task[], projectName?: string): string {
  const lines: string[] = [];
  if (projectName) lines.push(`# ${projectName} — Tasks\n`);

  const byStatus = {
    in_progress: tasks.filter((t) => t.status === "in_progress"),
    backlog: tasks.filter((t) => t.status === "backlog"),
    todo: tasks.filter((t) => t.status === "todo"),
    done: tasks.filter((t) => t.status === "done"),
    approved: tasks.filter((t) => t.status === "approved"),
    archived: tasks.filter((t) => t.status === "archived"),
  };

  for (const [status, items] of Object.entries(byStatus)) {
    if (items.length === 0) continue;
    const label = status === "in_progress" ? "In Progress" : status === "backlog" ? "Backlog" : status.charAt(0).toUpperCase() + status.slice(1);
    lines.push(`## ${label} (${items.length})\n`);
    for (const task of items) {
      const checkbox = status === "done" || status === "approved" || status === "archived" ? "[x]" : "[ ]";
      lines.push(`- ${checkbox} **${task.title}** (${task.priority})`);
      if (task.description) lines.push(`  > ${task.description.split("\n")[0]}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function downloadFile(content: string, filename: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
