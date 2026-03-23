// ============================================================
// Project
// ============================================================

export interface Project {
  id: string;
  name: string;
  path: string;
  favorite: boolean;
  category: string | null;
  techStack: string[];
  externalLinks: ExternalLink[];
  aiCommitMode: "commit" | "stage" | "none";
  notionDatabaseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalLink {
  label: string;
  url: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  category?: string;
}

export interface UpdateProjectInput {
  name?: string;
  favorite?: boolean;
  category?: string | null;
  techStack?: string[];
  externalLinks?: ExternalLink[];
  aiCommitMode?: "commit" | "stage" | "none";
  notionDatabaseId?: string | null;
}

export interface ScannedProject {
  name: string;
  path: string;
  techStack: string[];
}

// ============================================================
// Task
// ============================================================

export type TaskStatus = "backlog" | "todo" | "in_progress" | "done";
export type TaskPriority = "urgent" | "high" | "medium" | "low";

export interface Task {
  id: string;
  projectId: string;
  milestoneId: string | null;
  title: string;
  description: string | null;
  prompt: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  taskNumber: number;
  sortOrder: number;
  inboxAt: string | null;
  inProgressAt: string | null;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  prompt?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  milestoneId?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  prompt?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  milestoneId?: string | null;
  sortOrder?: number;
}

export interface TaskFilters {
  status?: TaskStatus;
  milestoneId?: string | null;
  search?: string;
  sort?: "priority" | "newest" | "oldest" | "updated";
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

// ============================================================
// Milestone
// ============================================================

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  status: "active" | "closed";
  createdAt: string;
}

export interface CreateMilestoneInput {
  name: string;
}

export interface UpdateMilestoneInput {
  name?: string;
  status?: "active" | "closed";
}

// ============================================================
// Git
// ============================================================

export interface GitStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
}

export interface FileChange {
  path: string;
  status: string; // M, A, D, R, C, etc.
  oldPath?: string; // for renames
}

export interface GitLogEntry {
  hash: string;
  hashShort: string;
  author: string;
  date: string;
  message: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
}

// ============================================================
// GitHub Account
// ============================================================

export interface GitHubAccount {
  id: string;
  name: string;
  hasToken: boolean;
  createdAt: string;
}

export interface ProjectGitHubMapping {
  projectId: string;
  subPath: string;
  githubAccountId: string;
}

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

export interface AppSettings {
  claudeApiKey?: string;
  notionApiKey?: string;
  mcpEnabled?: boolean;
  mcpAuthRequired?: boolean;
  soundEnabled?: boolean;
  terminalShell?: "powershell" | "cmd" | "bash";
}

// ============================================================
// Claude AI
// ============================================================

export interface ClaudeStatus {
  cliAvailable: boolean;
  apiKeyConfigured: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ============================================================
// Report
// ============================================================

export interface ReportEntry {
  task: Task;
  projectName: string;
  hours: number;
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
// Terminal
// ============================================================

export type TerminalSessionType = "shell" | "dev" | "claude-ai" | "ai-resolve";

// REST API types
export interface TerminalSessionInfo {
  id: string;
  type: TerminalSessionType;
  projectId?: string;
  taskId?: string;
  cwd: string;
  alive: boolean;
}

export interface CreateTerminalSessionInput {
  projectId?: string;
  type: TerminalSessionType;
  cols?: number;
  rows?: number;
  taskId?: string;
  prompt?: string;
  devCommand?: string;
}

export interface TerminalStatusResponse {
  available: boolean;
}

// Per-session WebSocket messages (client → server)
export interface TerminalWsInputMessage {
  type: "input";
  data: string;
}

export interface TerminalWsResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

export interface TerminalWsBinaryMessage {
  type: "binary";
  data: string;
}

export type TerminalWsClientMessage =
  | TerminalWsInputMessage
  | TerminalWsResizeMessage
  | TerminalWsBinaryMessage;

// Per-session WebSocket messages (server → client)
export interface TerminalOutputMessage {
  type: "output";
  data: string;
}

export interface TerminalExitMessage {
  type: "exit";
  exitCode: number;
}

export interface TerminalErrorMessage {
  type: "error";
  message: string;
}

export type TerminalWsServerMessage =
  | TerminalOutputMessage
  | TerminalExitMessage
  | TerminalErrorMessage;

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

// ============================================================
// Notion
// ============================================================

export interface NotionDatabase {
  id: string;
  title: string;
  url: string;
  icon: string | null;
  lastEditedTime: string;
}

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  icon: string | null;
  lastEditedTime: string;
  properties: Record<string, unknown>;
}

export interface NotionPageContent {
  id: string;
  title: string;
  url: string;
  markdown: string;
}

export interface NotionSearchResult {
  id: string;
  title: string;
  type: "page" | "database";
  url: string;
  icon: string | null;
  lastEditedTime: string;
}
