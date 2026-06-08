import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Inbox, Loader2, CheckCircle2, ShieldCheck, Archive } from "lucide-react";
import SortableTaskCard from "./SortableTaskCard";
import InlineTaskCreate from "@/components/tasks/InlineTaskCreate";
import type { Task, TaskStatus, CICheckResult } from "@vibe-kanban/shared";

const COLUMN_ICONS: Record<string, typeof Inbox> = {
  inbox: Inbox,
  in_progress: Loader2,
  done: CheckCircle2,
  approved: ShieldCheck,
  archived: Archive,
};

const COLUMN_ICON_COLORS: Record<string, string> = {
  inbox: "text-blue-500",
  in_progress: "text-yellow-500",
  done: "text-green-500",
  approved: "text-emerald-500",
  archived: "text-muted-foreground",
};

interface KanbanColumnProps {
  id: string;
  title: string;
  tasks: Task[];
  total: number;
  projectId: string;
  defaultStatus: TaskStatus;
  ciResults?: Map<string, CICheckResult>;
  headerAction?: ReactNode;
  onTaskClick: (task: Task) => void;
  onAIResolve?: (task: Task) => void;
  onAnalyze?: (task: Task) => void;
  onEdit?: (task: Task) => void;
  onClone?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

export default function KanbanColumn({
  id,
  title,
  tasks,
  total,
  projectId,
  defaultStatus,
  ciResults,
  headerAction,
  onTaskClick,
  onAIResolve,
  onAnalyze,
  onEdit,
  onClone,
  onDelete,
  onLoadMore,
  hasMore,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const Icon = COLUMN_ICONS[id] ?? Inbox;
  const iconColor = COLUMN_ICON_COLORS[id] ?? "text-muted-foreground";

  return (
    <div
      className={`flex flex-col flex-1 min-w-[300px] max-w-[400px] rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm overflow-hidden transition-all ${
        isOver ? "ring-2 ring-primary/30 border-primary/40" : ""
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-secondary/30 border-b border-border/40">
        <Icon className={`h-4 w-4 ${iconColor}`} />
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
          {total}
        </span>
        {headerAction}
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`flex-1 p-2 transition-colors ${isOver ? "bg-primary/5" : ""}`}
      >
        <ScrollArea className="h-[calc(100vh-280px)]">
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2 p-1">
              {tasks.map((task) => (
                <SortableTaskCard
                  key={task.id}
                  task={task}
                  ciResult={task.branch && ciResults ? ciResults.get(task.branch) : undefined}
                  onClick={() => onTaskClick(task)}
                  onAIResolve={onAIResolve ? () => onAIResolve(task) : undefined}
                  onAnalyze={onAnalyze ? () => onAnalyze(task) : undefined}
                  onEdit={onEdit ? () => onEdit(task) : undefined}
                  onClone={onClone ? () => onClone(task) : undefined}
                  onDelete={onDelete ? () => onDelete(task) : undefined}
                />
              ))}

              {tasks.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
                  <Icon className={`h-8 w-8 mb-2 ${iconColor} opacity-50`} />
                  <p className="text-xs">No tasks</p>
                </div>
              )}
            </div>
          </SortableContext>

          {hasMore && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onLoadMore}
            >
              Load more ({total - tasks.length} remaining)
            </Button>
          )}
        </ScrollArea>
      </div>

      {/* Inline create - pinned to bottom */}
      <div className="px-2 pb-2 pt-1 border-t border-border/30">
        <InlineTaskCreate projectId={projectId} defaultStatus={defaultStatus} />
      </div>
    </div>
  );
}
