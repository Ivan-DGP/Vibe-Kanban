import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CreateTerminalSessionInput,
  TerminalSessionInfo,
  BatchResolveInput,
} from "@vibe-kanban/shared";

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

// Known Claude interactive sessions VK has spawned (for the resume picker).
export function useClaudeSessions(projectId?: string, enabled = true) {
  return useQuery({
    queryKey: ["terminal", "claude-sessions", projectId],
    queryFn: () => api.terminal.claudeSessions(projectId),
    enabled,
    staleTime: 10_000,
  });
}

// A session's persisted transcript (available after it exits). Only fetched
// when `enabled` (e.g. a viewer dialog is open).
export function useTranscript(sessionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["terminal", "transcript", sessionId],
    queryFn: () => api.terminal.transcript(sessionId as string),
    enabled: enabled && !!sessionId,
    retry: false,
    staleTime: Infinity,
  });
}

export function useCreateTerminalSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTerminalSessionInput) => api.terminal.create(input),
    onSuccess: (created) => {
      // Optimistically seed the new session into the cached lists so the panel's
      // reconcile effect doesn't briefly see a stale-empty list and unmount the
      // just-mounted terminal (which would churn the WS and drop early input).
      qc.setQueriesData<TerminalSessionInfo[]>({ queryKey: ["terminal", "sessions"] }, (old) =>
        old ? (old.some((s) => s.id === created.id) ? old : [...old, created]) : [created],
      );
      qc.invalidateQueries({ queryKey: ["terminal", "sessions"] });
      qc.invalidateQueries({ queryKey: ["terminal", "claude-sessions"] });
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
      const previousQueries = qc.getQueriesData<TerminalSessionInfo[]>({
        queryKey: ["terminal", "sessions"],
      });

      // Optimistically remove the killed session from all cached queries
      qc.setQueriesData<TerminalSessionInfo[]>({ queryKey: ["terminal", "sessions"] }, (old) =>
        old?.filter((s) => s.id !== sessionId),
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
