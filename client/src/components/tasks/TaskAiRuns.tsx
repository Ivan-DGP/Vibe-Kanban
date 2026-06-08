import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTaskAiRuns, useCancelRun } from "@/hooks/useClaude";
import type { TaskAiRun } from "@vibe-kanban/shared";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default",
  succeeded: "secondary",
  failed: "destructive",
  canceled: "outline",
};

function statusOf(r: TaskAiRun): string {
  return r.status ?? (r.success ? "succeeded" : "failed");
}

function fmtDuration(ms?: number | null): string | null {
  if (!ms || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtCost(c?: number | null): string | null {
  return typeof c === "number" ? `$${c.toFixed(4)}` : null;
}

export default function TaskAiRuns({ taskId }: { taskId: string }) {
  const { data: runs = [] } = useTaskAiRuns(taskId);
  const cancel = useCancelRun(taskId);
  if (!runs.length) return null;

  return (
    <>
      <Separator />
      <div className="space-y-1.5 text-xs">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          AI Runs
        </div>
        {runs.slice(0, 8).map((r: TaskAiRun) => {
          const status = statusOf(r);
          const duration = fmtDuration(r.durationMs);
          const cost = fmtCost(r.totalCostUsd);
          return (
            <div key={r.id} className="flex items-center gap-2 flex-wrap">
              <Badge variant={STATUS_VARIANT[status] ?? "outline"} className="gap-1">
                {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                {status}
              </Badge>
              <span className="text-muted-foreground">{r.profile}</span>
              {duration && <span className="text-muted-foreground">{duration}</span>}
              {cost && <span className="text-muted-foreground">{cost}</span>}
              <span className="text-muted-foreground">
                {formatDistanceToNow(new Date(r.startedAt ?? r.createdAt), { addSuffix: true })}
              </span>
              {status === "running" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-5 px-2 text-[10px]"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(r.id)}
                >
                  Cancel
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
