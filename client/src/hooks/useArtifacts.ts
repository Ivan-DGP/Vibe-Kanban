import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateArtifactInput, UpdateArtifactInput } from "@vibe-kanban/shared";

export function useArtifacts(
  projectId: string | undefined,
  params?: { type?: string; search?: string },
) {
  return useQuery({
    queryKey: ["artifacts", projectId, params],
    queryFn: () => api.artifacts.list(projectId!, params),
    enabled: !!projectId,
  });
}

export function useArtifact(projectId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ["artifact", id],
    queryFn: () => api.artifacts.get(projectId!, id!),
    enabled: !!projectId && !!id,
  });
}

export function useArtifactContent(projectId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ["artifact-content", id],
    queryFn: () => api.artifacts.getContent(projectId!, id!),
    enabled: !!projectId && !!id,
  });
}

export function useArtifactLinks(projectId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ["artifact-links", id],
    queryFn: () => api.artifacts.links(projectId!, id!),
    enabled: !!projectId && !!id,
  });
}

export function useCreateArtifact(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateArtifactInput) => api.artifacts.create(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["artifacts", projectId] }),
  });
}

export function useUploadArtifact(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.artifacts.upload(projectId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["artifacts", projectId] }),
  });
}

export function useUpdateArtifact(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateArtifactInput }) =>
      api.artifacts.update(projectId, id, input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
      qc.invalidateQueries({ queryKey: ["artifact", vars.id] });
      qc.invalidateQueries({ queryKey: ["artifact-content", vars.id] });
      qc.invalidateQueries({ queryKey: ["artifact-links", vars.id] });
      qc.invalidateQueries({ queryKey: ["graph", projectId] });
    },
  });
}

export function useDeleteArtifact(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.artifacts.delete(projectId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["artifacts", projectId] }),
  });
}
