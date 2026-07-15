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
  CICheckResult,
  AiPreflightResult,
  TaskAiRun,
  ProjectAiStats,
  TerminalSessionInfo,
  TerminalStatusResponse,
  CreateTerminalSessionInput,
  ClaudeSessionInfo,
  BatchResolveInput,
  BatchResolveStatus,
  Todo,
  CreateTodoInput,
  UpdateTodoInput,
  NotionDatabase,
  NotionPage,
  NotionPageContent,
  NotionSearchResult,
  ApiCollection,
  CreateApiCollectionInput,
  UpdateApiCollectionInput,
  ApiRequest,
  CreateApiRequestInput,
  UpdateApiRequestInput,
  ApiRequestExecuteInput,
  ApiRequestExecuteResult,
  Artifact,
  KnowledgeSearchResponse,
  KnowledgeStats,
  CreateArtifactInput,
  UpdateArtifactInput,
  ArtifactLinksResponse,
  RoadmapItem,
  CreateRoadmapItemInput,
  UpdateRoadmapItemInput,
  ProjectGraph,
  DepGraph,
  GraphNode,
  GraphEdge,
  CreateGraphNodeInput,
  UpdateGraphNodeInput,
  CreateGraphEdgeInput,
  InterviewQa,
  BenchRunSummary,
  BenchFixture,
  BenchActiveRun,
  BenchTriggerInput,
  BenchAggregate,
  BenchAggregateBucket,
  BenchDriftProjectAgg,
  BenchDriftStats,
  BenchAiInfo,
  BenchTestsInfo,
  BenchDiffInfo,
  BenchResult,
  BenchReport,
} from "@vibe-kanban/shared";

// Re-export the Bench* wire types so existing consumers importing from
// "@/lib/api" keep working; canonical definitions now live in shared.
export type {
  BenchRunSummary,
  BenchFixture,
  BenchActiveRun,
  BenchTriggerInput,
  BenchAggregate,
  BenchAggregateBucket,
  BenchDriftProjectAgg,
  BenchDriftStats,
  BenchAiInfo,
  BenchTestsInfo,
  BenchDiffInfo,
  BenchResult,
  BenchReport,
};

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
    update: (id: string, input: UpdateProjectInput) => patch<Project>(`/projects/${id}`, input),
    delete: (id: string) => del(`/projects/${id}`),
    scan: (directories: string[]) => post<ScannedProject[]>("/projects/scan", { directories }),
  },

  tasks: {
    list: (projectId: string, filters: TaskFilters = {}) =>
      get<PaginatedResponse<Task>>(
        `/projects/${projectId}/tasks${toQuery(filters as Record<string, unknown>)}`,
      ),
    get: (id: string) => get<Task>(`/tasks/${id}`),
    create: (projectId: string, input: CreateTaskInput) =>
      post<Task>(`/projects/${projectId}/tasks`, input),
    update: (id: string, input: UpdateTaskInput) => patch<Task>(`/tasks/${id}`, input),
    delete: (id: string) => del(`/tasks/${id}`),
    reorder: (tasks: { id: string; sortOrder: number; status?: string }[]) =>
      patch<void>("/tasks/reorder", { tasks }),
    all: (params: { status?: string; sort?: string; limit?: number; offset?: number } = {}) =>
      get<PaginatedResponse<Task & { projectName?: string }>>(
        `/tasks/all${toQuery(params as Record<string, unknown>)}`,
      ),
    search: (q: string) =>
      get<(Task & { projectName?: string })[]>(`/tasks/search?q=${encodeURIComponent(q)}`),
    workingOn: () => get<Task[]>("/tasks/working-on"),
    bulkImport: (projectId: string, tasks: CreateTaskInput[]) =>
      post<Task[]>(`/projects/${projectId}/tasks/bulk-import`, { tasks }),
    archiveApproved: (projectId: string) =>
      post<{ archived: number }>(`/projects/${projectId}/tasks/archive-approved`, {}),
    aiPreflight: (projectId: string, taskId: string) =>
      get<AiPreflightResult>(`/projects/${projectId}/tasks/${taskId}/ai-preflight`),
    aiResolvePrompt: (projectId: string, taskId: string) =>
      post<{ prompt: string }>(`/projects/${projectId}/tasks/${taskId}/ai-resolve`, {}),
    aiRuns: (taskId: string) => get<TaskAiRun[]>(`/tasks/${taskId}/ai-runs`),
    aiStats: (projectId: string) => get<ProjectAiStats>(`/projects/${projectId}/ai-stats`),
    decompose: (projectId: string, taskId: string) =>
      post<{ parentTaskId: string; subtasks: Task[] }>(
        `/projects/${projectId}/tasks/${taskId}/decompose`,
        {},
      ),
  },

  milestones: {
    list: (projectId: string) => get<Milestone[]>(`/projects/${projectId}/milestones`),
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
      get<GitBranch[]>(`/projects/${projectId}/git/branches${toQuery({ subPath })}`),
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
      get<string>(`/projects/${projectId}/git/diff${toQuery({ file, subPath })}`),
    checkout: (projectId: string, branch: string, subPath?: string) =>
      post(`/projects/${projectId}/git/checkout`, { branch, subPath }),
    createBranch: (projectId: string, branch: string, baseBranch?: string, subPath?: string) =>
      post(`/projects/${projectId}/git/create-branch`, { branch, baseBranch, subPath }),
    subRepos: (projectId: string) => get<string[]>(`/projects/${projectId}/git/sub-repos`),
    divergence: (projectId: string, subPath?: string) =>
      get<{ mainBranch: string | null; ahead: number; behind: number }>(
        `/projects/${projectId}/git/divergence${toQuery({ subPath })}`,
      ),
  },

  files: {
    list: (projectId: string, dirPath?: string) =>
      get<FileEntry[]>(`/projects/${projectId}/files${toQuery({ path: dirPath })}`),
    read: (projectId: string, filePath: string) =>
      get<{ content: string; encoding: string }>(
        `/projects/${projectId}/files/read${toQuery({ path: filePath })}`,
      ),
    write: (projectId: string, filePath: string, content: string) =>
      put(`/projects/${projectId}/files/write`, { path: filePath, content }),
    create: (projectId: string, filePath: string, type: "file" | "directory") =>
      post(`/projects/${projectId}/files/create`, { path: filePath, type }),
    rename: (projectId: string, oldPath: string, newPath: string) =>
      post(`/projects/${projectId}/files/rename`, { oldPath, newPath }),
    delete: (projectId: string, filePath: string) =>
      del(`/projects/${projectId}/files/delete?path=${encodeURIComponent(filePath)}`),
    search: (projectId: string, q: string, caseSensitive?: boolean) =>
      get(`/projects/${projectId}/files/search${toQuery({ q, caseSensitive })}`),
  },

  claude: {
    status: () => get<ClaudeStatus>("/claude/status"),
    chat: (message: string, projectId?: string, signal?: AbortSignal) =>
      fetch("/api/claude/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, projectId }),
        signal,
      }),
    bulkImport: (projectId: string, text: string) =>
      post<CreateTaskInput[]>(`/claude/bulk-import`, { projectId, text }),
    activeRuns: () =>
      get<{
        stats: { inFlight: number; queued: number; cap: number; active: number };
        runs: unknown[];
      }>("/claude/runs/active"),
    cancelRun: (runId: string) => post<{ ok: boolean }>(`/claude/runs/${runId}/cancel`, {}),
    resumeRun: (runId: string) => post<{ ok: boolean }>(`/claude/runs/${runId}/resume`, {}),
    analyze: (projectId: string, taskId: string, signal?: AbortSignal) =>
      fetch("/api/claude/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, taskId }),
        signal,
      }),
    gatherContext: (
      taskTitle: string,
      projectId: string,
      taskDescription?: string,
      signal?: AbortSignal,
    ) =>
      fetch("/api/claude/gather-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskTitle, taskDescription, projectId }),
        signal,
      }),
    interview: {
      next: (projectId: string, taskId: string, answers: InterviewQa[]) =>
        fetch("/api/claude/interview/next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, taskId, answers }),
        }),
      finalize: (projectId: string, taskId: string, answers: InterviewQa[]) =>
        post<{ ok: boolean; artifactId: string }>("/claude/interview/finalize", {
          projectId,
          taskId,
          answers,
        }),
    },
  },

  settings: {
    get: () => get<AppSettings>("/settings"),
    update: (settings: Partial<AppSettings>) => put<AppSettings>("/settings", settings),
  },

  logs: {
    query: (params?: { level?: string; category?: string; limit?: number; offset?: number }) =>
      get<PaginatedResponse<SystemLog>>(`/logs${toQuery(params ?? {})}`),
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
    mapping: {
      get: (projectId: string) =>
        get<{ projectId: string; subPath: string; githubAccountId: string; accountName: string }[]>(
          `/projects/${projectId}/github-mapping`,
        ),
      set: (projectId: string, githubAccountId: string, subPath: string = "") =>
        put<{ projectId: string; subPath: string; githubAccountId: string }>(
          `/projects/${projectId}/github-mapping`,
          { githubAccountId, subPath },
        ),
      clear: (projectId: string, subPath: string = "") =>
        del<{ ok: boolean }>(`/projects/${projectId}/github-mapping${toQuery({ subPath })}`),
    },
  },

  sync: {
    push: (url: string, tasks: unknown[]) => post("/sync/push", { url, tasks }),
    pull: (url: string) => post("/sync/pull", { url }),
  },

  terminal: {
    status: () => get<TerminalStatusResponse>("/terminal/status"),
    sessions: (projectId?: string) =>
      get<TerminalSessionInfo[]>(
        `/terminal/sessions${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      ),
    create: (input: CreateTerminalSessionInput) =>
      post<TerminalSessionInfo>("/terminal/sessions", input),
    kill: (sessionId: string) => del(`/terminal/sessions/${sessionId}`),
    aiSessions: () => get<TerminalSessionInfo[]>("/terminal/ai-sessions"),
    claudeSessions: (projectId?: string) =>
      get<ClaudeSessionInfo[]>(
        `/terminal/claude-sessions${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      ),
    transcript: (sessionId: string) =>
      get<{ sessionId: string; content: string }>(
        `/terminal/transcripts/${encodeURIComponent(sessionId)}`,
      ),
    batchResolve: (input: BatchResolveInput) =>
      post<BatchResolveStatus>("/terminal/batch-resolve", input),
    batchResolveStatus: () => get<BatchResolveStatus>("/terminal/batch-resolve/status"),
    batchResolveCancel: () => post<BatchResolveStatus>("/terminal/batch-resolve/cancel"),
  },

  todos: {
    list: () => get<Todo[]>("/todos"),
    create: (input: CreateTodoInput) => post<Todo>("/todos", input),
    update: (id: string, input: UpdateTodoInput) => patch<Todo>(`/todos/${id}`, input),
    delete: (id: string) => del(`/todos/${id}`),
    reorder: (todos: { id: string; sortOrder: number }[]) =>
      patch<void>("/todos/reorder", { todos }),
    clearCompleted: () => del("/todos/clear-completed"),
  },

  notion: {
    status: () =>
      get<{ connected: boolean; user: string | null; error?: string }>("/notion/status"),
    search: (query?: string, filter?: "database" | "page") =>
      post<{ results: NotionSearchResult[] }>("/notion/search", { query, filter }),
    databases: () => get<{ databases: NotionDatabase[] }>("/notion/databases"),
    databasePages: (databaseId: string) =>
      get<{ pages: NotionPage[] }>(`/notion/databases/${databaseId}/pages`),
    page: (pageId: string) => get<NotionPageContent>(`/notion/pages/${pageId}`),
    importDatabase: (projectId: string) =>
      post<{ imported: number; updated: number; total: number }>(
        `/projects/${projectId}/notion/import`,
        {},
      ),
  },

  ci: {
    status: (projectId: string, branch: string, subPath?: string) =>
      get<CICheckResult>(`/projects/${projectId}/ci-status${toQuery({ branch, subPath })}`),
    batchStatus: (projectId: string, branches: string[], subPath?: string) =>
      post<CICheckResult[]>(`/projects/${projectId}/ci-status/batch`, { branches, subPath }),
  },

  apiClient: {
    collections: {
      list: (projectId: string) => get<ApiCollection[]>(`/projects/${projectId}/api-collections`),
      create: (projectId: string, input: CreateApiCollectionInput) =>
        post<ApiCollection>(`/projects/${projectId}/api-collections`, input),
      update: (id: string, input: UpdateApiCollectionInput) =>
        patch<ApiCollection>(`/api-collections/${id}`, input),
      delete: (id: string) => del(`/api-collections/${id}`),
    },
    requests: {
      list: (collectionId: string) =>
        get<ApiRequest[]>(`/api-collections/${collectionId}/requests`),
      listByProject: (projectId: string) =>
        get<ApiRequest[]>(`/projects/${projectId}/api-requests`),
      create: (input: CreateApiRequestInput) => post<ApiRequest>("/api-requests", input),
      update: (id: string, input: UpdateApiRequestInput) =>
        patch<ApiRequest>(`/api-requests/${id}`, input),
      delete: (id: string) => del(`/api-requests/${id}`),
    },
    execute: (input: ApiRequestExecuteInput) =>
      post<ApiRequestExecuteResult>("/api-client/execute", input),
  },

  artifacts: {
    list: (
      projectId: string,
      params?: { type?: string; search?: string; limit?: number; offset?: number },
    ) =>
      get<PaginatedResponse<Artifact>>(`/projects/${projectId}/artifacts${toQuery(params ?? {})}`),
    get: (projectId: string, id: string) => get<Artifact>(`/projects/${projectId}/artifacts/${id}`),
    getContent: (projectId: string, id: string) =>
      get<{ content: string; encoding: string }>(`/projects/${projectId}/artifacts/${id}/content`),
    create: (projectId: string, input: CreateArtifactInput) =>
      post<Artifact>(`/projects/${projectId}/artifacts`, input),
    upload: async (projectId: string, file: File): Promise<Artifact> => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/artifacts/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      return res.json();
    },
    update: (projectId: string, id: string, input: UpdateArtifactInput) =>
      patch<Artifact>(`/projects/${projectId}/artifacts/${id}`, input),
    links: (projectId: string, id: string) =>
      get<ArtifactLinksResponse>(`/projects/${projectId}/artifacts/${id}/links`),
    delete: (projectId: string, id: string) => del(`/projects/${projectId}/artifacts/${id}`),
  },

  roadmap: {
    list: (projectId: string) => get<RoadmapItem[]>(`/projects/${projectId}/roadmap`),
    create: (projectId: string, input: CreateRoadmapItemInput) =>
      post<RoadmapItem>(`/projects/${projectId}/roadmap`, input),
    update: (id: string, input: UpdateRoadmapItemInput) =>
      patch<RoadmapItem>(`/roadmap/${id}`, input),
    delete: (id: string) => del(`/roadmap/${id}`),
  },

  knowledge: {
    search: (
      projectId: string,
      body: {
        query: string;
        k?: number;
        minScore?: number;
        types?: ("artifact" | "task" | "graph_node")[];
      },
    ) => post<KnowledgeSearchResponse>(`/projects/${projectId}/knowledge/search`, body),
    stats: (projectId: string) => get<KnowledgeStats>(`/projects/${projectId}/knowledge/stats`),
    backfill: (projectId: string, force?: boolean) =>
      post<{ started: boolean; total: number }>(`/projects/${projectId}/knowledge/backfill`, {
        force: !!force,
      }),
  },

  graph: {
    get: (projectId: string) => get<ProjectGraph>(`/projects/${projectId}/graph`),
    createNode: (projectId: string, input: CreateGraphNodeInput) =>
      post<GraphNode>(`/projects/${projectId}/graph/nodes`, input),
    updateNode: (id: string, input: UpdateGraphNodeInput) =>
      patch<GraphNode>(`/graph/nodes/${id}`, input),
    deleteNode: (id: string) => del(`/graph/nodes/${id}`),
    createEdge: (projectId: string, input: CreateGraphEdgeInput) =>
      post(`/projects/${projectId}/graph/edges`, input),
    deleteEdge: (id: string) => del(`/graph/edges/${id}`),
    confirmNode: (id: string) => post<GraphNode>(`/graph/nodes/${id}/confirm`, {}),
    confirmEdge: (id: string) => post<GraphEdge>(`/graph/edges/${id}/confirm`, {}),
    confirmSuggestions: (projectId: string, input: { nodeIds?: string[]; edgeIds?: string[] }) =>
      post<{ nodesConfirmed: number; edgesConfirmed: number }>(
        `/projects/${projectId}/graph/confirm`,
        input,
      ),
  },
  depGraph: {
    get: (projectId: string, refresh = false) =>
      get<DepGraph>(`/projects/${projectId}/dep-graph${refresh ? "?refresh=true" : ""}`),
    toKnowledge: (projectId: string) =>
      post<{ nodes: number; edges: number; fileCount: number }>(
        `/projects/${projectId}/graph/from-dependencies`,
        {},
      ),
  },

  benchmarks: {
    listRuns: () => get<{ runs: BenchRunSummary[] }>("/benchmarks/runs"),
    getRun: (id: string) => get<BenchReport>(`/benchmarks/runs/${encodeURIComponent(id)}`),
    fixtures: () => get<{ fixtures: BenchFixture[] }>("/benchmarks/fixtures"),
    aggregate: () => get<BenchAggregate>("/benchmarks/aggregate"),
    active: () => get<{ runs: BenchActiveRun[] }>("/benchmarks/active"),
    drift: () => get<BenchDriftStats>("/benchmarks/drift"),
    trigger: (input: BenchTriggerInput) =>
      post<{
        runId: string;
        startedAt: string;
        args: string[];
        fixtures: string[];
        spawned: boolean;
      }>("/benchmarks/runs", input),
  },
};
