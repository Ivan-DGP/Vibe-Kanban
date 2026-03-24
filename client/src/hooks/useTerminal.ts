import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateTerminalSessionInput, TerminalSessionInfo, BatchResolveInput, BatchResolveStatus } from "@vibe-kanban/shared";

// ── React Query hooks ──────────────────────────────────────────

export function useTerminalStatus() {
  return useQuery({
    queryKey: ["terminal", "status"],
    queryFn: () => api.terminal.status(),
    staleTime: Infinity,
  });
}

export function useTerminalSessions(projectId?: string) {
  return useQuery({
    queryKey: ["terminal", "sessions", projectId],
    queryFn: () => api.terminal.sessions(projectId),
    refetchInterval: 5000,
  });
}

export function useCreateTerminalSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTerminalSessionInput) => api.terminal.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminal", "sessions"] });
    },
  });
}

export function useKillTerminalSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.terminal.kill(sessionId),
    onMutate: async (sessionId) => {
      // Cancel in-flight refetches so they don't overwrite the optimistic update
      await qc.cancelQueries({ queryKey: ["terminal", "sessions"] });

      // Snapshot all cached session queries for rollback
      const previousQueries = qc.getQueriesData<TerminalSessionInfo[]>({ queryKey: ["terminal", "sessions"] });

      // Optimistically remove the killed session from all cached queries
      qc.setQueriesData<TerminalSessionInfo[]>(
        { queryKey: ["terminal", "sessions"] },
        (old) => old?.filter((s) => s.id !== sessionId),
      );

      return { previousQueries };
    },
    onError: (_err, _sessionId, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        for (const [key, data] of context.previousQueries) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["terminal", "sessions"] });
    },
  });
}

// ── Batch AI Resolve ──────────────────────────────────────────

export function useBatchResolve() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BatchResolveInput) => api.terminal.batchResolve(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminal", "sessions"] });
      qc.invalidateQueries({ queryKey: ["batch-resolve"] });
    },
  });
}

export function useBatchResolveStatus(enabled: boolean = true) {
  return useQuery({
    queryKey: ["batch-resolve", "status"],
    queryFn: () => api.terminal.batchResolveStatus(),
    refetchInterval: enabled ? 2000 : false,
  });
}

export function useCancelBatchResolve() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.terminal.batchResolveCancel(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batch-resolve"] });
      qc.invalidateQueries({ queryKey: ["terminal", "sessions"] });
    },
  });
}

// ── WebSocket URL helper ───────────────────────────────────────

export function getWebSocketUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/terminal/${sessionId}`;
}
