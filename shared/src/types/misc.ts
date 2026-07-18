import type { Task } from "./task";

// ============================================================
// System Log
// ============================================================

export type LogLevel = "info" | "warn" | "error";
export type LogCategory =
  | "server"
  | "git"
  | "claude"
  | "sync"
  | "terminal"
  | "mcp"
  | "tasks"
  | "files";

export interface SystemLog {
  id: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details: unknown | null;
  createdAt: string;
}

// ============================================================
// Settings
// ============================================================

// AI resolver agent — the CLI that drives AI Resolve / batch resolve.
export type AiAgent = "claude" | "opencode" | "grok";

export interface AppSettings {
  claudeApiKey?: string;
  notionApiKey?: string;
  mcpEnabled?: boolean;
  mcpAuthRequired?: boolean;
  soundEnabled?: boolean;
  terminalShell?: "powershell" | "cmd" | "bash";
  aiAgent?: AiAgent;
}

// ============================================================
// Report
// ============================================================

export interface ReportEntry {
  task: Task;
  projectName: string;
  hours: number;
  summary?: string | null;
}

export interface Report {
  period: string;
  from: string;
  to: string;
  totalTasks: number;
  totalHours: number;
  avgHoursPerTask: number;
  byProject: {
    projectId: string;
    projectName: string;
    tasks: ReportEntry[];
    totalHours: number;
  }[];
}

// ============================================================
// File Explorer
// ============================================================

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

// ============================================================
// MCP
// ============================================================

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ============================================================
// Todo (Personal)
// ============================================================

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  linkedTaskId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTodoInput {
  title: string;
  linkedTaskId?: string | null;
}

export interface UpdateTodoInput {
  title?: string;
  completed?: boolean;
  linkedTaskId?: string | null;
  sortOrder?: number;
}
