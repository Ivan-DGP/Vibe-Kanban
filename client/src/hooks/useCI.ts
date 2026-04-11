import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CICheckResult } from "@vibe-kanban/shared";

export function useCIStatus(projectId: string | undefined, branch: string | null | undefined) {
  return useQuery({
    queryKey: ["ci-status", projectId, branch],
    queryFn: () => api.ci.status(projectId!, branch!),
    enabled: !!projectId && !!branch,
    refetchInterval: 30_000, // Poll every 30s
    staleTime: 15_000,
    retry: false,
  });
}

export function useBatchCIStatus(projectId: string | undefined, branches: string[]) {
  return useQuery<CICheckResult[]>({
    queryKey: ["ci-status-batch", projectId, branches.sort().join(",")],
    queryFn: () => api.ci.batchStatus(projectId!, branches),
    enabled: !!projectId && branches.length > 0,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: false,
  });
}
