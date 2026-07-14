import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TaskAiRun, InterviewQa } from "@vibe-kanban/shared";

export function useClaudeStatus() {
  return useQuery({
    queryKey: ["claude-status"],
    queryFn: () => api.claude.status(),
    staleTime: 60_000,
  });
}

export function useBulkImportAI(projectId: string) {
  return useMutation({
    mutationFn: (text: string) => api.claude.bulkImport(projectId, text),
  });
}

/**
 * AI run history for a task. Polls while any run is in flight OR parked for
 * usage-limit auto-resume, so live status + the resume countdown stay current.
 */
export function useTaskAiRuns(taskId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["task-ai-runs", taskId],
    queryFn: () => api.tasks.aiRuns(taskId as string),
    enabled: enabled && !!taskId,
    refetchInterval: (query) => {
      const runs = (query.state.data as TaskAiRun[] | undefined) ?? [];
      return runs.some((r) => r.status === "running" || r.status === "waiting_limit")
        ? 3000
        : false;
    },
  });
}

export function useCancelRun(taskId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.claude.cancelRun(runId),
    onSuccess: () => {
      if (taskId) qc.invalidateQueries({ queryKey: ["task-ai-runs", taskId] });
    },
  });
}

/** Manual "Resume now" for a parked ('waiting_limit') run. */
export function useResumeRun(taskId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.claude.resumeRun(runId),
    onSuccess: () => {
      if (taskId) qc.invalidateQueries({ queryKey: ["task-ai-runs", taskId] });
    },
  });
}

/** Finalize an interview into a spec artifact → invalidate the artifact list. */
export function useFinalizeInterview(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, answers }: { taskId: string; answers: InterviewQa[] }) =>
      api.claude.interview.finalize(projectId, taskId, answers),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["artifacts", projectId] }),
  });
}

// --- Streaming SSE endpoints ------------------------------------------------
// These return the raw fetch Response so callers can read the stream directly.
// Not cacheable via TanStack Query; exposed here only so components go through
// the hooks layer instead of importing the api client.
export function claudeChat(message: string, projectId?: string, signal?: AbortSignal) {
  return api.claude.chat(message, projectId, signal);
}

export function claudeAnalyze(projectId: string, taskId: string, signal?: AbortSignal) {
  return api.claude.analyze(projectId, taskId, signal);
}

export function claudeGatherContext(
  taskTitle: string,
  projectId: string,
  taskDescription?: string,
  signal?: AbortSignal,
) {
  return api.claude.gatherContext(taskTitle, projectId, taskDescription, signal);
}

export function claudeInterviewNext(projectId: string, taskId: string, answers: InterviewQa[]) {
  return api.claude.interview.next(projectId, taskId, answers);
}
