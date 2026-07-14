import { cn } from "@/lib/utils";
import { Zap, Sparkles, Pencil, Copy, Trash2, GitBranch } from "lucide-react";
import PriorityBadge from "@/components/ui/PriorityBadge";
import CIStatusBadge from "@/components/ui/CIStatusBadge";
import type { Task, CICheckResult } from "@vibe-kanban/shared";

interface TaskCardProps {
  task: Task;
  ciResult?: CICheckResult;
  onClick?: () => void;
  onAIResolve?: () => void;
  onAnalyze?: () => void;
  onEdit?: () => void;
  onClone?: () => void;
  onDelete?: () => void;
  dragHandleProps?: Record<string, unknown>;
  className?: string;
}

export default function TaskCard({
  task,
  ciResult,
  onClick,
  onAIResolve,
  onAnalyze,
  onEdit,
  onClone,
  onDelete,
  dragHandleProps,
  className,
}: TaskCardProps) {
  const hasActions = onAIResolve || onAnalyze || onEdit || onClone || onDelete;

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-card p-3 text-sm cursor-pointer",
        "shadow-sm hover:shadow-md hover:border-border",
        "transition-all duration-150 ease-out",
        "group relative",
        className,
      )}
      onClick={onClick}
      {...dragHandleProps}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {(task as any).taskNumber > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground/60 mt-0.5 shrink-0">
              #{(task as any).taskNumber}
            </span>
          )}
          <span className="font-medium leading-tight line-clamp-2">{task.title}</span>
        </div>
        <PriorityBadge priority={task.priority} />
      </div>
      {task.description && (
        <p className="text-xs text-muted-foreground/80 mt-1.5 line-clamp-1 leading-relaxed">
          {task.description}
        </p>
      )}
      {task.branch && (
        <div className="flex items-center gap-1 mt-1">
          <GitBranch className="h-3 w-3 text-muted-foreground/60" />
          <span className="text-[10px] text-muted-foreground/60 font-mono truncate">
            {task.branch}
          </span>
          {ciResult && <CIStatusBadge ciResult={ciResult} className="ml-auto" />}
        </div>
      )}

      {/* Hover action buttons */}
      {hasActions && (
        <div className="absolute top-1.5 right-1.5 hidden group-hover:flex items-center gap-0.5 bg-card/95 backdrop-blur-sm border border-border/60 rounded-md p-0.5 shadow-lg">
          {onAIResolve && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAIResolve();
              }}
              className="p-1 rounded hover:bg-primary/15 text-primary transition-colors"
              title="AI Resolve"
            >
              <Zap className="h-3.5 w-3.5" />
            </button>
          )}
          {onAnalyze && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAnalyze();
              }}
              className="p-1 rounded hover:bg-purple-500/15 text-purple-400 transition-colors"
              title="Analyze"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>
          )}
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onClone && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClone();
              }}
              className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
              title="Clone"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1 rounded hover:bg-red-500/15 text-red-400 transition-colors"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
