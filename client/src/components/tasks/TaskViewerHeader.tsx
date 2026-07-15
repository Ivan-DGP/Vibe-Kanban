import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { GitBranch } from "lucide-react";
import PriorityBadge from "@/components/ui/PriorityBadge";
import { STATUS_LABELS } from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";
import type { Task } from "@vibe-kanban/shared";

export default function TaskViewerHeader({ task }: { task: Task }) {
  return (
    <DialogHeader>
      <div className="flex items-start gap-2">
        <DialogTitle className="flex-1">{task.title}</DialogTitle>
        <PriorityBadge priority={task.priority} />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
        <Badge variant="secondary">{STATUS_LABELS[task.status]}</Badge>
        {task.branch && (
          <Badge variant="outline" className="gap-1 font-mono text-[10px]">
            <GitBranch className="h-3 w-3" />
            {task.branch}
          </Badge>
        )}
        {task.promptProfile && task.promptProfile !== "auto" && (
          <Badge variant="outline" className="text-[10px]">
            {task.promptProfile}
          </Badge>
        )}
        <span>Created {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}</span>
      </div>
    </DialogHeader>
  );
}
