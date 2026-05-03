import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useKnowledgeStats(projectId: string | undefined) {
  return useQuery({
    queryKey: ["knowledge-stats", projectId],
    queryFn: () => api.knowledge.stats(projectId!),
    enabled: !!projectId,
    refetchInterval: 5000,
  });
}

export function useKnowledgeSearch(projectId: string) {
  return useMutation({
    mutationFn: (input: { query: string; k?: number; minScore?: number }) =>
      api.knowledge.search(projectId, input),
  });
}

export function useKnowledgeBackfill(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force?: boolean) => api.knowledge.backfill(projectId, force),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-stats", projectId] }),
  });
}
