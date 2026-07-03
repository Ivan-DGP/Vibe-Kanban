import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTaskAiRuns, useCancelRun, useResumeRun } from "@/hooks/useClaude";
import type { TaskAiRun } from "@vibe-kanban/shared";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default",
  succeeded: "secondary",
  failed: "destructive",
  canceled: "outline",
  waiting_limit: "outline",
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

/** Countdown to a resume time. h:mm:ss over an hour, else mm:ss; "Resuming…" at 0. */
function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Resuming…";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function TaskAiRuns({ taskId }: { taskId: string }) {
  const { data: runs = [] } = useTaskAiRuns(taskId);
  const cancel = useCancelRun(taskId);
  const resume = useResumeRun(taskId);

  // Tick once a second while any run is parked, so the countdown stays live.
  const hasWaiting = runs.some((r: TaskAiRun) => statusOf(r) === "waiting_limit");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasWaiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasWaiting]);

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
          const waiting = status === "waiting_limit";
          const remainingMs = waiting && r.resumeAt ? new Date(r.resumeAt).getTime() - now : 0;
          return (
            <div key={r.id} className="flex items-center gap-2 flex-wrap">
              <Badge
                variant={STATUS_VARIANT[status] ?? "outline"}
                className={
                  waiting ? "gap-1 border-amber-500 text-amber-600 dark:text-amber-400" : "gap-1"
                }
              >
                {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                {waiting && <Clock className="h-3 w-3" />}
                {waiting ? "Paused — usage limit" : status}
              </Badge>
              <span className="text-muted-foreground">{r.profile}</span>
              {duration && <span className="text-muted-foreground">{duration}</span>}
              {cost && <span className="text-muted-foreground">{cost}</span>}
              {waiting && r.resumeAt && (
                <span className="text-amber-600 dark:text-amber-400">
                  Resumes in {fmtCountdown(remainingMs)}
                </span>
              )}
              {waiting && !!r.resumeAttempts && r.resumeAttempts > 0 && (
                <span className="text-muted-foreground">retry {r.resumeAttempts}</span>
              )}
              {!waiting && (
                <span className="text-muted-foreground">
                  {formatDistanceToNow(new Date(r.startedAt ?? r.createdAt), { addSuffix: true })}
                </span>
              )}
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
              {waiting && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-5 px-2 text-[10px]"
                    disabled={resume.isPending}
                    onClick={() => resume.mutate(r.id)}
                  >
                    Resume now
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-5 px-2 text-[10px]"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(r.id)}
                  >
                    Cancel
                  </Button>
                </>
              )}
              {r.groundedArtifacts && r.groundedArtifacts.length > 0 && (
                <div className="w-full pl-1 text-[10px] text-muted-foreground">
                  <span className="font-medium">Grounded in:</span>{" "}
                  {r.groundedArtifacts.map((a) => a.title).join(", ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
