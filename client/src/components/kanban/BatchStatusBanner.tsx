import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BatchResolveStatus } from "@vibe-kanban/shared";

interface BatchStatusBannerProps {
  status: BatchResolveStatus | undefined;
  onCancel: () => void;
}

export default function BatchStatusBanner({ status, onCancel }: BatchStatusBannerProps) {
  if (!status) return null;

  return (
    <>
      {status.state === "running" && (
        <div className="flex items-center gap-3 rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-2.5">
          <div className="h-6 w-6 rounded-full bg-purple-500/15 flex items-center justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">
              Resolving {status.completedTasks}/{status.totalTasks}
              {(status.concurrency ?? 1) > 1 && (
                <span className="text-muted-foreground font-normal ml-1.5">
                  ({status.activeTasks?.length ?? 0} active)
                </span>
              )}
            </div>
            {(status.concurrency ?? 1) <= 1 && status.currentTaskTitle && (
              <div className="text-xs text-muted-foreground truncate">
                {status.currentTaskTitle}
              </div>
            )}
            {(status.concurrency ?? 1) > 1 &&
              status.activeTasks &&
              status.activeTasks.length > 0 && (
                <div className="text-xs text-muted-foreground truncate">
                  {status.activeTasks.map((t) => t.taskTitle).join(", ")}
                </div>
              )}
          </div>
          <div className="w-32 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full transition-all"
              style={{ width: `${(status.completedTasks / status.totalTasks) * 100}%` }}
            />
          </div>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}

      {status.state === "completed" && status.totalTasks > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-2 text-sm">
          <span className="text-green-400">Batch resolve complete:</span>
          <span>
            {status.completedTasks}/{status.totalTasks} tasks processed
          </span>
        </div>
      )}
    </>
  );
}
