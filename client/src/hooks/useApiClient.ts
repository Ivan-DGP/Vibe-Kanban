import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CreateApiCollectionInput,
  UpdateApiCollectionInput,
  CreateApiRequestInput,
  UpdateApiRequestInput,
  ApiRequestExecuteInput,
} from "@vibe-kanban/shared";

// Collections
export function useApiCollections(projectId: string | undefined) {
  return useQuery({
    queryKey: ["api-collections", projectId],
    queryFn: () => api.apiClient.collections.list(projectId!),
    enabled: !!projectId,
  });
}

export function useCreateApiCollection(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiCollectionInput) =>
      api.apiClient.collections.create(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-collections", projectId] }),
  });
}

export function useUpdateApiCollection(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateApiCollectionInput }) =>
      api.apiClient.collections.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-collections", projectId] }),
  });
}

export function useDeleteApiCollection(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.apiClient.collections.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-collections", projectId] });
      qc.invalidateQueries({ queryKey: ["api-requests"] });
    },
  });
}

// Requests
export function useApiRequests(collectionId: string | undefined) {
  return useQuery({
    queryKey: ["api-requests", collectionId],
    queryFn: () => api.apiClient.requests.list(collectionId!),
    enabled: !!collectionId,
  });
}

export function useProjectApiRequests(projectId: string | undefined) {
  return useQuery({
    queryKey: ["api-requests-project", projectId],
    queryFn: () => api.apiClient.requests.listByProject(projectId!),
    enabled: !!projectId,
  });
}

export function useCreateApiRequest(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiRequestInput) => api.apiClient.requests.create(input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["api-requests", vars.collectionId] });
      qc.invalidateQueries({ queryKey: ["api-requests-project", projectId] });
    },
  });
}

export function useUpdateApiRequest(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateApiRequestInput }) =>
      api.apiClient.requests.update(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-requests-project", projectId] });
    },
  });
}

export function useDeleteApiRequest(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.apiClient.requests.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-requests-project", projectId] });
    },
  });
}

// Execute
export function useExecuteRequest() {
  return useMutation({
    mutationFn: (input: ApiRequestExecuteInput) => api.apiClient.execute(input),
  });
}
