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
  treeDepth: number;
  aiInstructions: string | null;
  notionDatabaseId: string | null;
  autoSpawnEnabled: boolean;
  qaAgentPath: string | null;
  qaAgentPython: string | null;
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
  treeDepth?: number;
  aiInstructions?: string | null;
  notionDatabaseId?: string | null;
  autoSpawnEnabled?: boolean;
  qaAgentPath?: string | null;
  qaAgentPython?: string | null;
}

export interface ScannedProject {
  name: string;
  path: string;
  techStack: string[];
}

// ============================================================
// Task
// ============================================================

export type TaskStatus = "backlog" | "todo" | "in_progress" | "done" | "approved" | "archived";
export type TaskPriority = "urgent" | "high" | "medium" | "low";
export type PromptProfile = "auto" | "quick-fix" | "feature" | "refactor" | "bug-fix" | "docs";

export interface Task {
  id: string;
  projectId: string;
  milestoneId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  prompt: string | null;
  branch: string | null;
  promptProfile: PromptProfile;
  status: TaskStatus;
  priority: TaskPriority;
  taskNumber: number;
  sortOrder: number;
  inboxAt: string | null;
  inProgressAt: string | null;
  doneAt: string | null;
  approvedAt: string | null;
  archivedAt: string | null;
  notionPageId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  prompt?: string;
  branch?: string;
  promptProfile?: PromptProfile;
  status?: TaskStatus;
  priority?: TaskPriority;
  milestoneId?: string | null;
  parentTaskId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  prompt?: string | null;
  branch?: string | null;
  promptProfile?: PromptProfile;
  status?: TaskStatus;
  priority?: TaskPriority;
  milestoneId?: string | null;
  sortOrder?: number;
}

export interface AiPreflightResult {
  taskId: string;
  title: string;
  detectedProfile: Exclude<PromptProfile, "auto">;
  effectiveProfile: PromptProfile;
  scope: "small" | "medium" | "large";
  hasDescription: boolean;
  hasPrompt: boolean;
  warnings: string[];
  branch: string | null;
}

export interface TaskAiRun {
  id: string;
  taskId: string;
  projectId: string;
  sessionId: string | null;
  profile: string;
  complexity: "small" | "medium" | "large";
  exitCode: number | null;
  success: boolean;
  filesChanged: number | null;
  durationMs: number | null;
  summary: string | null;
  createdAt: string;
}

export interface ProjectAiStats {
  totalRuns: number;
  successCount: number;
  successRate: number;
  avgDurationMs: number | null;
  commonFailures: string[];
  profileBreakdown: Record<string, number>;
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
  aiInstructions: string | null;
  createdAt: string;
}

export interface CreateMilestoneInput {
  name: string;
}

export interface UpdateMilestoneInput {
  name?: string;
  status?: "active" | "closed";
  aiInstructions?: string | null;
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
  username: string | null;
  email: string | null;
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

export type TerminalSessionType = "shell" | "dev" | "claude-ai" | "ai-resolve" | "ai-test";

// REST API types
export interface TerminalSessionInfo {
  id: string;
  type: TerminalSessionType;
  projectId?: string;
  taskId?: string;
  name?: string;
  cwd: string;
  alive: boolean;
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

// ============================================================
// Project Artifacts (Knowledge Base)
// ============================================================

export type ArtifactType = "document" | "diagram" | "image" | "research" | "spec" | "other";

export interface Artifact {
  id: string;
  projectId: string;
  filename: string;
  type: ArtifactType;
  description: string | null;
  tags: string[];
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateArtifactInput {
  filename: string;
  type?: ArtifactType;
  description?: string;
  tags?: string[];
  content?: string; // for text-based artifacts (markdown, etc.)
}

export interface UpdateArtifactInput {
  filename?: string;
  type?: ArtifactType;
  description?: string | null;
  tags?: string[];
  content?: string;
}

// ============================================================
// Knowledge Search (Vector Embeddings)
// ============================================================

export interface KnowledgeArtifactHit {
  kind: "artifact";
  id: string;
  entityId: string;
  chunkIdx: number;
  content: string;
  score: number;
  artifact: {
    id: string;
    filename: string;
    type: ArtifactType;
    description: string | null;
    tags: string[];
    mimeType: string;
    updatedAt: string;
  };
}

export interface KnowledgeTaskHit {
  kind: "task";
  id: string;
  entityId: string;
  chunkIdx: number;
  content: string;
  score: number;
  task: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    taskNumber: number;
    milestoneId: string | null;
    updatedAt: string;
  };
}

export type KnowledgeSearchHit = KnowledgeArtifactHit | KnowledgeTaskHit;

export interface KnowledgeSearchResponse {
  query: string;
  model: string;
  results: KnowledgeSearchHit[];
  totalChunks: number;
}

export interface KnowledgeStats {
  model: string;
  artifactCount: number;
  embeddedArtifacts: number;
  chunkCount: number;
  pending: number;
  taskCount: number;
  embeddedTasks: number;
  taskChunkCount: number;
  pendingTasks: number;
}

// ============================================================
// Knowledge Graph
// ============================================================

export type GraphNodeType = "concept" | "system" | "person" | "decision" | "technology" | "risk";
export type GraphEdgeType = "related" | "depends_on" | "implements" | "extends" | "conflicts" | "owned_by";

export interface GraphNode {
  id: string;
  projectId: string;
  label: string;
  type: GraphNodeType;
  description: string | null;
  x: number | null;
  y: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string | null;
  type: GraphEdgeType;
  createdAt: string;
}

export interface ProjectGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface CreateGraphNodeInput {
  label: string;
  type?: GraphNodeType;
  description?: string;
  x?: number;
  y?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateGraphNodeInput {
  label?: string;
  type?: GraphNodeType;
  description?: string | null;
  x?: number;
  y?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateGraphEdgeInput {
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  type?: GraphEdgeType;
}

// ============================================================
// Roadmap
// ============================================================

export type RoadmapItemStatus = "planned" | "in_progress" | "completed" | "blocked";

export interface RoadmapItem {
  id: string;
  projectId: string;
  milestoneId: string | null;
  title: string;
  description: string | null;
  status: RoadmapItemStatus;
  startDate: string | null;
  endDate: string | null;
  dependsOn: string[]; // array of roadmap item IDs
  color: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoadmapItemInput {
  title: string;
  description?: string;
  status?: RoadmapItemStatus;
  milestoneId?: string | null;
  startDate?: string;
  endDate?: string;
  dependsOn?: string[];
  color?: string;
}

export interface UpdateRoadmapItemInput {
  title?: string;
  description?: string | null;
  status?: RoadmapItemStatus;
  milestoneId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  dependsOn?: string[];
  color?: string | null;
  sortOrder?: number;
}

// ============================================================
// CI/CD (GitHub Actions)
// ============================================================

export type CIStatus = "success" | "failure" | "pending" | "running" | "unknown";

export interface CICheckResult {
  branch: string;
  status: CIStatus;
  conclusion: string | null;
  workflowName: string | null;
  runUrl: string | null;
  updatedAt: string | null;
}

// ============================================================
// API Client (Postman/Bruno style)
// ============================================================

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface ApiCollection {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApiCollectionInput {
  name: string;
}

export interface UpdateApiCollectionInput {
  name?: string;
  sortOrder?: number;
}

export interface ApiRequest {
  id: string;
  collectionId: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: string; // JSON string of key-value pairs
  body: string;
  sortOrder: number;
  lastResponseStatus: number | null;
  lastResponseTime: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApiRequestInput {
  collectionId: string;
  name: string;
  method?: HttpMethod;
  url?: string;
  headers?: string;
  body?: string;
}

export interface UpdateApiRequestInput {
  name?: string;
  method?: HttpMethod;
  url?: string;
  headers?: string;
  body?: string;
  sortOrder?: number;
  lastResponseStatus?: number | null;
  lastResponseTime?: number | null;
}

export interface ApiRequestExecuteInput {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ApiRequestExecuteResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timeMs: number;
}
