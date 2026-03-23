import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateTodoInput, UpdateTodoInput } from "@vibe-kanban/shared";

export function useTodos() {
  return useQuery({
    queryKey: ["todos"],
    queryFn: () => api.todos.list(),
  });
}

export function useCreateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTodoInput) => api.todos.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });
}

export function useUpdateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTodoInput }) =>
      api.todos.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });
}

export function useDeleteTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.todos.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });
}

export function useReorderTodos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (todos: { id: string; sortOrder: number }[]) =>
      api.todos.reorder(todos),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });
}

export function useClearCompletedTodos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.todos.clearCompleted(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });
}
