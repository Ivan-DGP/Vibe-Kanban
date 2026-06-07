import type { TaskPriority, TaskStatus } from "@vibe-kanban/shared";

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: "text-red-500 bg-red-500/10 border-red-500/30",
  high: "text-orange-500 bg-orange-500/10 border-orange-500/30",
  medium: "text-yellow-500 bg-yellow-500/10 border-yellow-500/30",
  low: "text-muted-foreground bg-muted border-muted",
};

export const PRIORITY_BORDER_COLORS: Record<TaskPriority, string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-yellow-500",
  low: "border-l-muted-foreground/30",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Inbox",
  todo: "Inbox",
  in_progress: "In Progress",
  done: "Done",
  approved: "Approved",
  archived: "Archived",
};

export const STATUS_COLUMN_MAP: Record<string, TaskStatus[]> = {
  inbox: ["backlog", "todo"],
  in_progress: ["in_progress"],
  done: ["done"],
  approved: ["approved"],
  archived: ["archived"],
};

export const SORT_OPTIONS = [
  { value: "priority", label: "Priority" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "updated", label: "Recently Updated" },
] as const;

export const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this-week", label: "This Week" },
  { value: "this-month", label: "This Month" },
  { value: "last-7", label: "Last 7 Days" },
  { value: "last-30", label: "Last 30 Days" },
  { value: "custom", label: "Custom Range" },
] as const;

export const TECH_STACK_COLORS: Record<string, string> = {
  React: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  Vue: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  Svelte: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  "Next.js": "bg-neutral-500/10 text-neutral-600 border-neutral-500/30",
  Nuxt: "bg-green-500/10 text-green-600 border-green-500/30",
  Angular: "bg-red-500/10 text-red-600 border-red-500/30",
  TypeScript: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  Python: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  Go: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30",
  Rust: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  Tailwind: "bg-teal-500/10 text-teal-600 border-teal-500/30",
  Fastify: "bg-neutral-500/10 text-neutral-600 border-neutral-500/30",
  Express: "bg-neutral-500/10 text-neutral-600 border-neutral-500/30",
  Vite: "bg-purple-500/10 text-purple-600 border-purple-500/30",
  Prisma: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  Drizzle: "bg-lime-500/10 text-lime-600 border-lime-500/30",
  Electron: "bg-slate-500/10 text-slate-600 border-slate-500/30",
  SolidJS: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  Astro: "bg-purple-500/10 text-purple-600 border-purple-500/30",
};

export const LOG_LEVEL_COLORS = {
  info: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  warn: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  error: "bg-red-500/10 text-red-600 border-red-500/30",
};

export const LOG_CATEGORIES = [
  "server",
  "git",
  "claude",
  "sync",
  "terminal",
  "mcp",
  "tasks",
  "files",
] as const;

export const PAGE_SIZE = 15;
