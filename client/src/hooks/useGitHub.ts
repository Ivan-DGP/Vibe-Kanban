import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useGitHubAccounts() {
  return useQuery({
    queryKey: ["github-accounts"],
    queryFn: () => api.github.list(),
  });
}

export function useCreateGitHubAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, token }: { name: string; token: string }) =>
      api.github.create(name, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["github-accounts"] }),
  });
}

export function useUpdateGitHubAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; token?: string } }) =>
      api.github.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["github-accounts"] }),
  });
}

export function useDeleteGitHubAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.github.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["github-accounts"] }),
  });
}

export function useGitHubMapping(projectId: string | undefined) {
  return useQuery({
    queryKey: ["github-mapping", projectId],
    queryFn: () => api.github.mapping.get(projectId!),
    enabled: !!projectId,
  });
}

export function useSetGitHubMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, githubAccountId, subPath }: { projectId: string; githubAccountId: string; subPath?: string }) =>
      api.github.mapping.set(projectId, githubAccountId, subPath),
    onSuccess: (_, { projectId }) =>
      qc.invalidateQueries({ queryKey: ["github-mapping", projectId] }),
  });
}

export function useClearGitHubMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, subPath }: { projectId: string; subPath?: string }) =>
      api.github.mapping.clear(projectId, subPath),
    onSuccess: (_, { projectId }) =>
      qc.invalidateQueries({ queryKey: ["github-mapping", projectId] }),
  });
}
