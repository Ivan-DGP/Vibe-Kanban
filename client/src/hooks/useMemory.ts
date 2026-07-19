import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateMemoryInput, MemoryType } from "@vibe-kanban/shared";

export function useMemory(
  projectId: string | undefined,
  params?: { type?: MemoryType; includeSuperseded?: boolean; limit?: number },
) {
  return useQuery({
    queryKey: ["memory", projectId, params ?? {}],
    queryFn: () => api.memory.list(projectId!, params),
    enabled: !!projectId,
  });
}

export function useAppendMemory(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateMemoryInput, "projectId">) =>
      api.memory.create(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memory", projectId] }),
  });
}

export function useSupersedeMemory(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, newEventId }: { id: string; newEventId: string }) =>
      api.memory.supersede(projectId, id, newEventId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memory", projectId] }),
  });
}
