import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import KanbanColumn from "./KanbanColumn";
import type { Task, CICheckResult } from "@vibe-kanban/shared";

interface KanbanBoardColumnsProps {
  projectId: string;
  ciMap: Map<string, CICheckResult>;
  inboxTasks: Task[];
  inboxTotal: number;
  ipTasks: Task[];
  ipTotal: number;
  doneTasks: Task[];
  doneTotal: number;
  approvedTasks: Task[];
  approvedTotal: number;
  onTaskClick: (task: Task) => void;
  onAIResolve: (task: Task) => void;
  onAnalyze: (task: Task) => void;
  onEdit: (task: Task) => void;
  onClone: (task: Task) => void;
  onDelete: (task: Task) => void;
  onArchiveApproved: () => void;
  archiveApprovedPending: boolean;
  onLoadMoreInbox: () => void;
  onLoadMoreIp: () => void;
  onLoadMoreDone: () => void;
  onLoadMoreApproved: () => void;
}

export default function KanbanBoardColumns({
  projectId,
  ciMap,
  inboxTasks,
  inboxTotal,
  ipTasks,
  ipTotal,
  doneTasks,
  doneTotal,
  approvedTasks,
  approvedTotal,
  onTaskClick,
  onAIResolve,
  onAnalyze,
  onEdit,
  onClone,
  onDelete,
  onArchiveApproved,
  archiveApprovedPending,
  onLoadMoreInbox,
  onLoadMoreIp,
  onLoadMoreDone,
  onLoadMoreApproved,
}: KanbanBoardColumnsProps) {
  return (
    <div className="flex gap-5 overflow-x-auto pb-4">
      <KanbanColumn
        id="inbox"
        title="Inbox"
        tasks={inboxTasks}
        total={inboxTotal}
        projectId={projectId}
        defaultStatus="backlog"
        ciResults={ciMap}
        onTaskClick={onTaskClick}
        onAIResolve={onAIResolve}
        onAnalyze={onAnalyze}
        onEdit={onEdit}
        onClone={onClone}
        onDelete={onDelete}
        hasMore={inboxTasks.length < inboxTotal}
        onLoadMore={onLoadMoreInbox}
      />
      <KanbanColumn
        id="in_progress"
        title="In Progress"
        tasks={ipTasks}
        total={ipTotal}
        projectId={projectId}
        defaultStatus="in_progress"
        ciResults={ciMap}
        onTaskClick={onTaskClick}
        onAIResolve={onAIResolve}
        onAnalyze={onAnalyze}
        onEdit={onEdit}
        onClone={onClone}
        onDelete={onDelete}
        hasMore={ipTasks.length < ipTotal}
        onLoadMore={onLoadMoreIp}
      />
      <KanbanColumn
        id="done"
        title="Done"
        tasks={doneTasks}
        total={doneTotal}
        projectId={projectId}
        defaultStatus="done"
        ciResults={ciMap}
        onTaskClick={onTaskClick}
        onAIResolve={onAIResolve}
        onAnalyze={onAnalyze}
        onEdit={onEdit}
        onClone={onClone}
        onDelete={onDelete}
        hasMore={doneTasks.length < doneTotal}
        onLoadMore={onLoadMoreDone}
      />
      <KanbanColumn
        id="approved"
        title="Approved"
        tasks={approvedTasks}
        total={approvedTotal}
        projectId={projectId}
        defaultStatus="approved"
        ciResults={ciMap}
        headerAction={
          approvedTotal > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground ml-1"
              onClick={onArchiveApproved}
              disabled={archiveApprovedPending}
              title="Archive all approved tasks"
            >
              <Archive className="h-3 w-3 mr-1" />
              Archive
            </Button>
          ) : undefined
        }
        onTaskClick={onTaskClick}
        onAIResolve={onAIResolve}
        onAnalyze={onAnalyze}
        onEdit={onEdit}
        onClone={onClone}
        onDelete={onDelete}
        hasMore={approvedTasks.length < approvedTotal}
        onLoadMore={onLoadMoreApproved}
      />
    </div>
  );
}
