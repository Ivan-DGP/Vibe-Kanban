// ============================================================
// Terminal
// ============================================================

export type TerminalSessionType =
  | "shell"
  | "dev"
  | "claude-ai"
  | "ai-resolve"
  | "ai-test"
  | "claude-interactive";

// REST API types
export interface TerminalSessionInfo {
  id: string;
  type: TerminalSessionType;
  projectId?: string;
  taskId?: string;
  name?: string;
  cwd: string;
  alive: boolean;
  // For claude-interactive sessions: the selected model + the pinned Claude
  // session id (so the tab header can show them and a picker can resume).
  model?: string;
  claudeSessionId?: string;
}

export interface CreateTerminalSessionInput {
  projectId?: string;
  type: TerminalSessionType;
  cols?: number;
  rows?: number;
  taskId?: string;
  name?: string;
  prompt?: string;
  branch?: string;
  devCommand?: string;
  // claude-interactive options:
  model?: string; // → claude --model <model>
  resumeSessionId?: string; // → claude --resume <id>
  continueLast?: boolean; // → claude --continue
}

// A Claude interactive session VK has spawned (persisted so a picker can
// list/resume them). `id` is the Claude CLI --session-id UUID.
export interface ClaudeSessionInfo {
  id: string;
  projectId?: string;
  taskId?: string;
  model?: string;
  cwd: string;
  title?: string;
  createdAt: string;
  lastUsedAt: string;
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

// Batch AI Resolve
export interface BatchResolveInput {
  projectId: string;
  taskIds: string[];
  concurrency?: number;
  overrideBranch?: string;
}

export interface BatchResolveStatus {
  state: "idle" | "running" | "completed" | "cancelled";
  projectId?: string;
  totalTasks: number;
  completedTasks: number;
  concurrency?: number;
  currentTaskId?: string;
  currentTaskTitle?: string;
  currentSessionId?: string;
  activeTasks?: { taskId: string; taskTitle: string; sessionId: string }[];
  taskResults: { taskId: string; taskTitle: string; sessionId: string; exitCode?: number }[];
}
