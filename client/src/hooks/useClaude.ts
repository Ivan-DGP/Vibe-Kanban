import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

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
