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
