import { useWorkingOn } from "@/hooks";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PRIORITY_COLORS } from "@/lib/constants";
import type { Task } from "@vibe-kanban/shared";

export default function WorkingOnBanner() {
  const { data: tasks, isLoading } = useWorkingOn();
  const navigate = useNavigate();

  if (isLoading) return null;
  if (!tasks || tasks.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-6 w-6 rounded-full bg-blue-500/15 flex items-center justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
        </div>
        <span className="text-sm font-medium">Working On</span>
        <Badge variant="secondary" className="text-xs">{tasks.length}</Badge>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tasks.map((task: Task & { projectName?: string }) => (
          <button
            key={task.id}
            onClick={() => navigate(`/project/${task.projectId}`)}
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-sm hover:bg-card hover:border-primary/30 transition-all shrink-0 group"
          >
            <span className={`h-2 w-2 rounded-full ${PRIORITY_COLORS[task.priority].split(" ")[0].replace("text-", "bg-")}`} />
            <span className="max-w-[200px] truncate font-medium">{task.title}</span>
            {(task as Task & { projectName?: string }).projectName && (
              <span className="text-xs text-muted-foreground">
                {(task as Task & { projectName?: string }).projectName}
              </span>
            )}
            <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        ))}
      </div>
    </div>
  );
}
