import { useState } from "react";
import {
  useTodos,
  useCreateTodo,
  useUpdateTodo,
  useDeleteTodo,
  useClearCompletedTodos,
} from "@/hooks/useTodos";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  ListTodo,
  Link2,
  Sparkles,
} from "lucide-react";
import type { Todo } from "@vibe-kanban/shared";

export default function Todos() {
  const [newTitle, setNewTitle] = useState("");

  const { data: todos = [], isLoading } = useTodos();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const clearCompleted = useClearCompletedTodos();

  const completedCount = todos.filter((t: Todo) => t.completed).length;
  const pendingCount = todos.filter((t: Todo) => !t.completed).length;
  const totalCount = todos.length;

  function handleAdd() {
    const title = newTitle.trim();
    if (!title) return;
    createTodo.mutate({ title });
    setNewTitle("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  }

  function handleToggle(todo: Todo) {
    updateTodo.mutate({
      id: todo.id,
      input: { completed: !todo.completed },
    });
  }

  function handleDelete(id: string) {
    deleteTodo.mutate(id);
  }

  function handleClearCompleted() {
    clearCompleted.mutate();
  }

  return (
    <div className="p-6 max-w-[800px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Todo</h1>
          {totalCount > 0 && (
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/15 px-2 text-xs font-semibold text-primary">
              {pendingCount} pending
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground/70 mt-0.5">
          {totalCount > 0
            ? `${totalCount} todo${totalCount !== 1 ? "s" : ""} · ${completedCount} completed`
            : "Your personal todo list"}
        </p>
      </div>

      {/* Add todo input */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-lg">
          <Input
            placeholder="Add a new todo..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-10 bg-card/50 pr-10"
          />
        </div>
        <Button
          variant="default"
          size="sm"
          className="h-10 gap-2"
          onClick={handleAdd}
          disabled={!newTitle.trim()}
        >
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>

      {/* Todo list */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Circle className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : todos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-7 w-7 text-primary/60" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground/70">
              No todos yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add your first todo above to get started
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {todos.map((todo: Todo) => (
            <div
              key={todo.id}
              className={cn(
                "group flex items-center gap-3 rounded-lg border border-border/40 bg-card/50 p-3 transition-all hover:border-border/60",
                todo.completed && "opacity-60"
              )}
            >
              <Checkbox
                checked={todo.completed}
                onCheckedChange={() => handleToggle(todo)}
                className="h-5 w-5 transition-all duration-200"
              />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={cn(
                    "text-sm transition-all duration-200",
                    todo.completed &&
                      "text-muted-foreground line-through"
                  )}
                >
                  {todo.title}
                </span>
                {todo.linkedTaskId && (
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="hidden h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive group-hover:flex"
                onClick={() => handleDelete(todo.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Footer - Clear completed */}
      {completedCount > 0 && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={handleClearCompleted}
            disabled={clearCompleted.isPending}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Clear completed ({completedCount})
          </Button>
        </div>
      )}
    </div>
  );
}
