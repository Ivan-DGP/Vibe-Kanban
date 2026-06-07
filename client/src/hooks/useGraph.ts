import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CreateGraphNodeInput,
  UpdateGraphNodeInput,
  CreateGraphEdgeInput,
} from "@vibe-kanban/shared";

export function useGraph(projectId: string | undefined) {
  return useQuery({
    queryKey: ["graph", projectId],
    queryFn: () => api.graph.get(projectId!),
    enabled: !!projectId,
  });
}

export function useCreateGraphNode(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGraphNodeInput) => api.graph.createNode(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graph", projectId] }),
  });
}

export function useUpdateGraphNode(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateGraphNodeInput }) =>
      api.graph.updateNode(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graph", projectId] }),
  });
}

export function useDeleteGraphNode(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.graph.deleteNode(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graph", projectId] }),
  });
}

export function useCreateGraphEdge(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGraphEdgeInput) => api.graph.createEdge(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graph", projectId] }),
  });
}

export function useDeleteGraphEdge(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.graph.deleteEdge(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graph", projectId] }),
  });
}
