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

// Dependency (import) graph — extraction is a filesystem walk, so it's fetched
// lazily and only recomputed when the user explicitly refreshes.
export function useDepGraph(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["dep-graph", projectId],
    queryFn: () => api.depGraph.get(projectId!),
    enabled: !!projectId && enabled,
    staleTime: Infinity,
  });
}

export function useRefreshDepGraph(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.depGraph.get(projectId, true),
    onSuccess: (data) => qc.setQueryData(["dep-graph", projectId], data),
  });
}

// Draft suggested knowledge-graph nodes/edges from the dependency graph.
export function useGraphFromDeps(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.depGraph.toKnowledge(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graph", projectId] }),
  });
}

/** Transitive blast-radius for a task's candidate source files. */
export function useTaskImpact(projectId: string, files: string[]) {
  return useQuery({
    queryKey: ["impact", projectId, files],
    queryFn: () => api.depGraph.impact(projectId, files),
    enabled: !!projectId && files.length > 0,
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

export function useConfirmGraphNode(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.graph.confirmNode(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graph", projectId] }),
  });
}

export function useConfirmGraphEdge(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.graph.confirmEdge(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graph", projectId] }),
  });
}

export function useConfirmGraphSuggestions(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { nodeIds?: string[]; edgeIds?: string[] }) =>
      api.graph.confirmSuggestions(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["graph", projectId] }),
  });
}
