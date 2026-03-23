import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppSettings } from "@vibe-kanban/shared";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.settings.get(),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Partial<AppSettings>) => api.settings.update(settings),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
