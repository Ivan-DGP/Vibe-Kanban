import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useTasks } from "@/hooks/useTasks";
import { STATUS_LABELS } from "@/lib/constants";
import type { Task } from "@vibe-kanban/shared";

export default function TaskViewerSubtasks({
  projectId,
  parentTaskId,
}: {
  projectId: string;
  parentTaskId: string;
}) {
  const { data } = useTasks(projectId);
  const subtasks = data?.items?.filter((t: Task) => t.parentTaskId === parentTaskId) ?? [];

  if (subtasks.length === 0) return null;

  return (
    <>
      <Separator />
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Subtasks ({subtasks.length})
        </div>
        <div className="space-y-1">
          {subtasks.map((st: Task) => (
            <div key={st.id} className="flex items-center gap-2 text-xs">
              <Badge variant="secondary" className="text-[10px] shrink-0">
                {STATUS_LABELS[st.status]}
              </Badge>
              <span className="truncate">{st.title}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
