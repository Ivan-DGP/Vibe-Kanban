import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useLogs(params?: { level?: string; category?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ["logs", params],
    queryFn: () => api.logs.query(params),
  });
}

export function useClearLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.logs.clear(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logs"] }),
  });
}
