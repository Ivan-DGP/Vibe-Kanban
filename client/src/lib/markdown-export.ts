import type { Report } from "@vibe-kanban/shared";

export function reportToMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push(`# Report: ${report.period}`);
  lines.push(`**Period:** ${report.from} to ${report.to}`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Tasks | ${report.totalTasks} |`);
  lines.push(`| Total Hours | ${report.totalHours.toFixed(1)} |`);
  lines.push(`| Avg Hours/Task | ${report.avgHoursPerTask.toFixed(1)} |`);
  lines.push("");

  for (const group of report.byProject) {
    lines.push(`## ${group.projectName} (${group.totalHours.toFixed(1)}h)`);
    lines.push("");
    lines.push(`| Task | Priority | Hours |`);
    lines.push(`|------|----------|-------|`);
    for (const entry of group.tasks) {
      lines.push(`| ${entry.task.title} | ${entry.task.priority} | ${entry.hours.toFixed(1)} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
