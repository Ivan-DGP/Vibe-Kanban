import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useGitStatus(projectId: string | undefined, subPath?: string) {
  return useQuery({
    queryKey: ["git-status", projectId, subPath],
    queryFn: () => api.git.status(projectId!, subPath),
    enabled: !!projectId,
    refetchInterval: 5000,
  });
}

export function useGitLog(projectId: string | undefined, subPath?: string) {
  return useQuery({
    queryKey: ["git-log", projectId, subPath],
    queryFn: () => api.git.log(projectId!, subPath),
    enabled: !!projectId,
  });
}

export function useGitBranches(projectId: string | undefined, subPath?: string) {
  return useQuery({
    queryKey: ["git-branches", projectId, subPath],
    queryFn: () => api.git.branches(projectId!, subPath),
    enabled: !!projectId,
  });
}

export function useGitDiff(projectId: string | undefined, file?: string, subPath?: string) {
  return useQuery({
    queryKey: ["git-diff", projectId, file, subPath],
    queryFn: () => api.git.diff(projectId!, file, subPath),
    enabled: !!projectId,
  });
}

export function useStageFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, files, subPath }: { projectId: string; files: string[]; subPath?: string }) =>
      api.git.stage(projectId, files, subPath),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["git-status"] }),
  });
}

export function useUnstageFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, files, subPath }: { projectId: string; files: string[]; subPath?: string }) =>
      api.git.unstage(projectId, files, subPath),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["git-status"] }),
  });
}

export function useCommit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, message, subPath }: { projectId: string; message: string; subPath?: string }) =>
      api.git.commit(projectId, message, subPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["git-status"] });
      qc.invalidateQueries({ queryKey: ["git-log"] });
    },
  });
}

export function usePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, subPath }: { projectId: string; subPath?: string }) =>
      api.git.push(projectId, subPath),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["git-status"] }),
  });
}

export function usePull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, subPath }: { projectId: string; subPath?: string }) =>
      api.git.pull(projectId, subPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["git-status"] });
      qc.invalidateQueries({ queryKey: ["git-log"] });
    },
  });
}

export function useDiscard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, files, subPath }: { projectId: string; files: string[]; subPath?: string }) =>
      api.git.discard(projectId, files, subPath),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["git-status"] }),
  });
}

export function useUndoCommit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, subPath }: { projectId: string; subPath?: string }) =>
      api.git.undoCommit(projectId, subPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["git-status"] });
      qc.invalidateQueries({ queryKey: ["git-log"] });
    },
  });
}

export function useCheckoutBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, branch, subPath }: { projectId: string; branch: string; subPath?: string }) =>
      api.git.checkout(projectId, branch, subPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["git-status"] });
      qc.invalidateQueries({ queryKey: ["git-log"] });
      qc.invalidateQueries({ queryKey: ["git-branches"] });
    },
  });
}

export function useGitSubRepos(projectId: string | undefined) {
  return useQuery({
    queryKey: ["git-sub-repos", projectId],
    queryFn: () => api.git.subRepos(projectId!),
    enabled: !!projectId,
  });
}

export function useGitDivergence(projectId: string | undefined, subPath?: string) {
  return useQuery({
    queryKey: ["git-divergence", projectId, subPath],
    queryFn: () => api.git.divergence(projectId!, subPath),
    enabled: !!projectId,
  });
}
