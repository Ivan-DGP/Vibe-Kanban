import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TerminalSessionType, CreateTerminalSessionInput, TerminalSessionInfo } from "@vibe-kanban/shared";

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminal", "sessions"] });
    },
  });
}

// ── WebSocket URL helper ───────────────────────────────────────

export function getWebSocketUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/terminal/${sessionId}`;
}
