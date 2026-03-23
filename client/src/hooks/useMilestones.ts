import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateMilestoneInput, UpdateMilestoneInput } from "@vibe-kanban/shared";

export function useMilestones(projectId: string | undefined) {
  return useQuery({
    queryKey: ["milestones", projectId],
    queryFn: () => api.milestones.list(projectId!),
    enabled: !!projectId,
  });
}

export function useCreateMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMilestoneInput) => api.milestones.create(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["milestones", projectId] }),
  });
}

export function useUpdateMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMilestoneInput }) =>
      api.milestones.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["milestones"] }),
  });
}

export function useDeleteMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.milestones.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["milestones"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
