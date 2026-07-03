import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TaskAiRun } from "@vibe-kanban/shared";

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
