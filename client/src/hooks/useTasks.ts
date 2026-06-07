import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateTaskInput, UpdateTaskInput, TaskFilters } from "@vibe-kanban/shared";

export function useTasks(projectId: string | undefined, filters: TaskFilters = {}) {
  return useQuery({
    queryKey: ["tasks", projectId, filters],
    queryFn: () => api.tasks.list(projectId!, filters),
    enabled: !!projectId,
    refetchInterval: 5000,
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ["task", id],
    queryFn: () => api.tasks.get(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => api.tasks.create(projectId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["working-on"] });
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaskInput }) =>
      api.tasks.update(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task"] });
      qc.invalidateQueries({ queryKey: ["working-on"] });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.tasks.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["working-on"] });
    },
  });
}

export function useReorderTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tasks: { id: string; sortOrder: number; status?: string }[]) =>
      api.tasks.reorder(tasks),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["working-on"] });
    },
  });
}

export function useAllTasks(
  params: { status?: string; sort?: string; limit?: number; offset?: number } = {},
) {
  return useQuery({
    queryKey: ["tasks-all", params],
    queryFn: () => api.tasks.all(params),
  });
}

export function useSearchTasks(q: string) {
  return useQuery({
    queryKey: ["tasks-search", q],
    queryFn: () => api.tasks.search(q),
    enabled: q.length >= 2,
  });
}

export function useWorkingOn() {
  return useQuery({
    queryKey: ["working-on"],
    queryFn: () => api.tasks.workingOn(),
    refetchInterval: 5000,
  });
}

export function useArchiveApproved(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.tasks.archiveApproved(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["project-stats"] });
    },
  });
}

export function useBulkImportTasks(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tasks: CreateTaskInput[]) => api.tasks.bulkImport(projectId, tasks),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectId] }),
  });
}
