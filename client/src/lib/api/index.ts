import { get, post, patch, put, del } from "./client";
import type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  ScannedProject,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilters,
  PaginatedResponse,
  Milestone,
  CreateMilestoneInput,
  UpdateMilestoneInput,
  GitStatus,
  GitLogEntry,
  GitBranch,
  FileEntry,
  SystemLog,
  AppSettings,
  ClaudeStatus,
  Report,
  GitHubAccount,
  TerminalSessionInfo,
  TerminalStatusResponse,
  CreateTerminalSessionInput,
  BatchResolveInput,
  BatchResolveStatus,
  Todo,
  CreateTodoInput,
  UpdateTodoInput,
  NotionDatabase,
  NotionPage,
  NotionPageContent,
  NotionSearchResult,
} from "@vibe-kanban/shared";

function toQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) sp.set(k, String(v));
  }
  const str = sp.toString();
  return str ? `?${str}` : "";
}

export interface BrowseResult {
  current: string;
  parent: string;
  folders: { name: string; path: string; isProject: boolean }[];
}

export const api = {
  browse: (dir?: string) =>
    get<BrowseResult>(`/browse${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`),

  projects: {
    list: (params?: { favorite?: boolean; category?: string }) =>
      get<Project[]>(`/projects${toQuery(params ?? {})}`),
    get: (id: string) => get<Project>(`/projects/${id}`),
    create: (input: CreateProjectInput) => post<Project>("/projects", input),
    update: (id: string, input: UpdateProjectInput) =>
      patch<Project>(`/projects/${id}`, input),
    delete: (id: string) => del(`/projects/${id}`),
    scan: (directories: string[]) =>
      post<ScannedProject[]>("/projects/scan", { directories }),
  },

  tasks: {
    list: (projectId: string, filters: TaskFilters = {}) =>
      get<PaginatedResponse<Task>>(
        `/projects/${projectId}/tasks${toQuery(filters as Record<string, unknown>)}`,
      ),
    get: (id: string) => get<Task>(`/tasks/${id}`),
    create: (projectId: string, input: CreateTaskInput) =>
      post<Task>(`/projects/${projectId}/tasks`, input),
    update: (id: string, input: UpdateTaskInput) =>
      patch<Task>(`/tasks/${id}`, input),
    delete: (id: string) => del(`/tasks/${id}`),
    reorder: (tasks: { id: string; sortOrder: number; status?: string }[]) =>
      patch<void>("/tasks/reorder", { tasks }),
    all: (params: { status?: string; sort?: string; limit?: number; offset?: number } = {}) =>
      get<PaginatedResponse<Task & { projectName?: string }>>(`/tasks/all${toQuery(params as Record<string, unknown>)}`),
    search: (q: string) => get<(Task & { projectName?: string })[]>(`/tasks/search?q=${encodeURIComponent(q)}`),
    workingOn: () => get<Task[]>("/tasks/working-on"),
    bulkImport: (projectId: string, tasks: CreateTaskInput[]) =>
      post<Task[]>(`/projects/${projectId}/tasks/bulk-import`, { tasks }),
    aiResolvePrompt: (projectId: string, taskId: string) =>
      post<{ prompt: string }>(`/projects/${projectId}/tasks/${taskId}/ai-resolve`, {}),
  },

  milestones: {
    list: (projectId: string) =>
      get<Milestone[]>(`/projects/${projectId}/milestones`),
    create: (projectId: string, input: CreateMilestoneInput) =>
      post<Milestone>(`/projects/${projectId}/milestones`, input),
    update: (id: string, input: UpdateMilestoneInput) =>
      patch<Milestone>(`/milestones/${id}`, input),
    delete: (id: string) => del(`/milestones/${id}`),
  },

  git: {
    status: (projectId: string, subPath?: string) =>
      get<GitStatus>(`/projects/${projectId}/git/status${toQuery({ subPath })}`),
    log: (projectId: string, subPath?: string) =>
      get<GitLogEntry[]>(`/projects/${projectId}/git/log${toQuery({ subPath })}`),
    branches: (projectId: string, subPath?: string) =>
      get<GitBranch[]>(
        `/projects/${projectId}/git/branches${toQuery({ subPath })}`,
      ),
    stage: (projectId: string, files: string[], subPath?: string) =>
      post(`/projects/${projectId}/git/stage`, { files, subPath }),
    unstage: (projectId: string, files: string[], subPath?: string) =>
      post(`/projects/${projectId}/git/unstage`, { files, subPath }),
    commit: (projectId: string, message: string, subPath?: string) =>
      post(`/projects/${projectId}/git/commit`, { message, subPath }),
    push: (projectId: string, subPath?: string) =>
      post(`/projects/${projectId}/git/push`, { subPath }),
    pull: (projectId: string, subPath?: string) =>
      post(`/projects/${projectId}/git/pull`, { subPath }),
    discard: (projectId: string, files: string[], subPath?: string) =>
      post(`/projects/${projectId}/git/discard`, { files, subPath }),
    undoCommit: (projectId: string, subPath?: string) =>
      post(`/projects/${projectId}/git/undo-commit`, { subPath }),
    diff: (projectId: string, file?: string, subPath?: string) =>
      get<string>(
        `/projects/${projectId}/git/diff${toQuery({ file, subPath })}`,
      ),
    checkout: (projectId: string, branch: string, subPath?: string) =>
      post(`/projects/${projectId}/git/checkout`, { branch, subPath }),
    subRepos: (projectId: string) =>
      get<string[]>(`/projects/${projectId}/git/sub-repos`),
    divergence: (projectId: string, subPath?: string) =>
      get<{ mainBranch: string | null; ahead: number; behind: number }>(
        `/projects/${projectId}/git/divergence${toQuery({ subPath })}`,
      ),
  },

  files: {
    list: (projectId: string, dirPath?: string) =>
      get<FileEntry[]>(
        `/projects/${projectId}/files${toQuery({ path: dirPath })}`,
      ),
    read: (projectId: string, filePath: string) =>
      get<{ content: string; encoding: string }>(
        `/projects/${projectId}/files/read${toQuery({ path: filePath })}`,
      ),
    write: (projectId: string, filePath: string, content: string) =>
      put(`/projects/${projectId}/files/write`, { path: filePath, content }),
    create: (
      projectId: string,
      filePath: string,
      type: "file" | "directory",
    ) =>
      post(`/projects/${projectId}/files/create`, { path: filePath, type }),
    rename: (projectId: string, oldPath: string, newPath: string) =>
      post(`/projects/${projectId}/files/rename`, { oldPath, newPath }),
    delete: (projectId: string, filePath: string) =>
      del(`/projects/${projectId}/files/delete?path=${encodeURIComponent(filePath)}`),
    search: (projectId: string, q: string, caseSensitive?: boolean) =>
      get(
        `/projects/${projectId}/files/search${toQuery({ q, caseSensitive })}`,
      ),
  },

  claude: {
    status: () => get<ClaudeStatus>("/claude/status"),
    chat: (message: string, projectId?: string) =>
      fetch("/api/claude/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, projectId }),
      }),
    bulkImport: (projectId: string, text: string) =>
      post<CreateTaskInput[]>(`/claude/bulk-import`, { projectId, text }),
  },

  settings: {
    get: () => get<AppSettings>("/settings"),
    update: (settings: Partial<AppSettings>) =>
      put<AppSettings>("/settings", settings),
  },

  logs: {
    query: (params?: {
      level?: string;
      category?: string;
      limit?: number;
      offset?: number;
    }) => get<PaginatedResponse<SystemLog>>(`/logs${toQuery(params ?? {})}`),
    clear: () => del("/logs"),
  },

  reports: {
    get: (params: { period: string; from?: string; to?: string }) =>
      get<Report>(`/reports${toQuery(params)}`),
  },

  github: {
    list: () => get<GitHubAccount[]>("/github-accounts"),
    create: (name: string, token: string) =>
      post<GitHubAccount>("/github-accounts", { name, token }),
    update: (id: string, data: { name?: string; token?: string }) =>
      patch<GitHubAccount>(`/github-accounts/${id}`, data),
    delete: (id: string) => del(`/github-accounts/${id}`),
  },

  sync: {
    push: (url: string, tasks: unknown[]) =>
      post("/sync/push", { url, tasks }),
    pull: (url: string) => post("/sync/pull", { url }),
  },

  terminal: {
    status: () => get<TerminalStatusResponse>("/terminal/status"),
    sessions: (projectId?: string) =>
      get<TerminalSessionInfo[]>(`/terminal/sessions${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
    create: (input: CreateTerminalSessionInput) =>
      post<TerminalSessionInfo>("/terminal/sessions", input),
    kill: (sessionId: string) => del(`/terminal/sessions/${sessionId}`),
    aiSessions: () => get<TerminalSessionInfo[]>("/terminal/ai-sessions"),
    batchResolve: (input: BatchResolveInput) =>
      post<BatchResolveStatus>("/terminal/batch-resolve", input),
    batchResolveStatus: () =>
      get<BatchResolveStatus>("/terminal/batch-resolve/status"),
    batchResolveCancel: () =>
      post<BatchResolveStatus>("/terminal/batch-resolve/cancel"),
  },

  todos: {
    list: () => get<Todo[]>("/todos"),
    create: (input: CreateTodoInput) => post<Todo>("/todos", input),
    update: (id: string, input: UpdateTodoInput) => patch<Todo>(`/todos/${id}`, input),
    delete: (id: string) => del(`/todos/${id}`),
    reorder: (todos: { id: string; sortOrder: number }[]) => patch<void>("/todos/reorder", { todos }),
    clearCompleted: () => del("/todos/clear-completed"),
  },

  notion: {
    status: () => get<{ connected: boolean; user: string | null; error?: string }>("/notion/status"),
    search: (query?: string, filter?: "database" | "page") =>
      post<{ results: NotionSearchResult[] }>("/notion/search", { query, filter }),
    databases: () => get<{ databases: NotionDatabase[] }>("/notion/databases"),
    databasePages: (databaseId: string) =>
      get<{ pages: NotionPage[] }>(`/notion/databases/${databaseId}/pages`),
    page: (pageId: string) => get<NotionPageContent>(`/notion/pages/${pageId}`),
  },
};
