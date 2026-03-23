import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useFileList(projectId: string | undefined, dirPath?: string) {
  return useQuery({
    queryKey: ["files", projectId, dirPath],
    queryFn: () => api.files.list(projectId!, dirPath),
    enabled: !!projectId,
  });
}

export function useFileContent(projectId: string | undefined, filePath: string | undefined) {
  return useQuery({
    queryKey: ["file-content", projectId, filePath],
    queryFn: () => api.files.read(projectId!, filePath!),
    enabled: !!projectId && !!filePath,
  });
}

export function useWriteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, filePath, content }: { projectId: string; filePath: string; content: string }) =>
      api.files.write(projectId, filePath, content),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["file-content", vars.projectId, vars.filePath] });
    },
  });
}

export function useCreateFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, filePath, type }: { projectId: string; filePath: string; type: "file" | "directory" }) =>
      api.files.create(projectId, filePath, type),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["files", vars.projectId] });
    },
  });
}

export function useRenameFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, oldPath, newPath }: { projectId: string; oldPath: string; newPath: string }) =>
      api.files.rename(projectId, oldPath, newPath),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["files", vars.projectId] });
      qc.invalidateQueries({ queryKey: ["file-content", vars.projectId] });
    },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, filePath }: { projectId: string; filePath: string }) =>
      api.files.delete(projectId, filePath),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["files", vars.projectId] });
    },
  });
}

export function useFileSearch(projectId: string | undefined, q: string, caseSensitive?: boolean) {
  return useQuery({
    queryKey: ["file-search", projectId, q, caseSensitive],
    queryFn: () => api.files.search(projectId!, q, caseSensitive),
    enabled: !!projectId && q.length >= 2,
  });
}
