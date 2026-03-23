import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, ListTodo, Inbox, Loader2, CheckCircle2 } from "lucide-react";
import { useAllTasks, useSearchTasks } from "@/hooks";
import TaskCard from "@/components/tasks/TaskCard";
import TaskViewerDialog from "@/components/tasks/TaskViewerDialog";
import type { Task } from "@vibe-kanban/shared";

const STATUS_FILTERS = [
  { value: "", label: "All", icon: ListTodo },
  { value: "backlog", label: "Inbox", icon: Inbox },
  { value: "in_progress", label: "In Progress", icon: Loader2 },
  { value: "done", label: "Done", icon: CheckCircle2 },
] as const;

export default function Tasks() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const navigate = useNavigate();

  const isSearching = debouncedQuery.length >= 2;
  const { data: searchResults, isLoading: searchLoading } = useSearchTasks(debouncedQuery);
  const { data: allData, isLoading: allLoading } = useAllTasks({
    status: statusFilter || undefined,
    sort: "updated",
    limit: 100,
  });

  const handleChange = (value: string) => {
    setQuery(value);
    const id = setTimeout(() => setDebouncedQuery(value), 300);
    return () => clearTimeout(id);
  };

  const tasks = isSearching ? (searchResults ?? []) : (allData?.items ?? []);
  const isLoading = isSearching ? searchLoading : allLoading;

  return (
    <div className="p-6 max-w-[1000px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground/70 mt-0.5">
          {allData ? `${allData.total} task${allData.total !== 1 ? "s" : ""} across all projects` : "All tasks across all projects"}
        </p>
      </div>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Search tasks..."
            className="pl-9 h-10 bg-card/50"
          />
        </div>

        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((sf) => {
            const Icon = sf.icon;
            return (
              <Button
                key={sf.value}
                variant={statusFilter === sf.value ? "secondary" : "ghost"}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setStatusFilter(sf.value)}
              >
                <Icon className="h-3.5 w-3.5" />
                {sf.label}
              </Button>
            );
          })}
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground animate-pulse">Loading...</p>
      )}

      {!isLoading && tasks.length > 0 ? (
        <div className="space-y-2">
          {tasks.map((task: Task & { projectName?: string }) => (
            <div key={task.id} className="flex items-center gap-2">
              <div className="flex-1">
                <TaskCard task={task} onClick={() => { setSelectedTask(task); setViewerOpen(true); }} />
              </div>
              {task.projectName && (
                <Badge
                  variant="outline"
                  className="text-[10px] shrink-0 cursor-pointer hover:bg-accent transition-colors"
                  onClick={() => navigate(`/project/${task.projectId}`)}
                >
                  {task.projectName}
                </Badge>
              )}
            </div>
          ))}
        </div>
      ) : !isLoading && isSearching ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Search className="h-8 w-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm">No tasks found for "{debouncedQuery}"</p>
        </div>
      ) : !isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/50">
          <ListTodo className="h-10 w-10 mb-3" />
          <p className="text-sm">No tasks yet</p>
        </div>
      ) : null}

      <TaskViewerDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        task={selectedTask}
      />
    </div>
  );
}
