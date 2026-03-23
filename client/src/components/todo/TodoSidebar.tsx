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
  X,
  CheckCircle2,
  Circle,
  ListTodo,
  Link2,
  Sparkles,
} from "lucide-react";
import type { Todo } from "@vibe-kanban/shared";

interface TodoSidebarProps {
  onClose: () => void;
}

export default function TodoSidebar({ onClose }: TodoSidebarProps) {
  const [newTitle, setNewTitle] = useState("");

  const { data: todos = [], isLoading } = useTodos();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const clearCompleted = useClearCompletedTodos();

  const completedCount = todos.filter((t: Todo) => t.completed).length;
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
    <div className="flex h-full w-80 flex-col border-l border-border/60 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-primary" />
          <h2 className="font-bold text-sm tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            Todo
          </h2>
          {totalCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
              {totalCount}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Add todo input */}
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
        <Input
          placeholder="Add a new todo..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-8 text-sm"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-primary hover:bg-primary/10 hover:text-primary"
          onClick={handleAdd}
          disabled={!newTitle.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Todo list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1.5 p-3">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <Circle className="h-5 w-5 animate-spin" />
              <span className="text-xs">Loading...</span>
            </div>
          ) : todos.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-6 w-6 text-primary/60" />
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
            todos.map((todo: Todo) => (
              <div
                key={todo.id}
                className={cn(
                  "group flex items-center gap-2.5 rounded-lg border border-border/40 bg-card/50 p-2.5 transition-all",
                  todo.completed && "opacity-60"
                )}
              >
                <Checkbox
                  checked={todo.completed}
                  onCheckedChange={() => handleToggle(todo)}
                  className="transition-all duration-200"
                />
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span
                    className={cn(
                      "truncate text-sm transition-all duration-200",
                      todo.completed &&
                        "text-muted-foreground line-through"
                    )}
                  >
                    {todo.title}
                  </span>
                  {todo.linkedTaskId && (
                    <Link2 className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive group-hover:flex"
                  onClick={() => handleDelete(todo.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer - Clear completed */}
      {completedCount > 0 && (
        <div className="border-t border-border/40 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-2 text-xs text-muted-foreground hover:text-foreground"
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
