import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateRoadmapItemInput, UpdateRoadmapItemInput } from "@vibe-kanban/shared";

export function useRoadmap(projectId: string | undefined) {
  return useQuery({
    queryKey: ["roadmap", projectId],
    queryFn: () => api.roadmap.list(projectId!),
    enabled: !!projectId,
  });
}

export function useCreateRoadmapItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoadmapItemInput) => api.roadmap.create(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roadmap", projectId] }),
  });
}

export function useUpdateRoadmapItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRoadmapItemInput }) =>
      api.roadmap.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roadmap", projectId] }),
  });
}

export function useDeleteRoadmapItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.roadmap.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roadmap", projectId] }),
  });
}
