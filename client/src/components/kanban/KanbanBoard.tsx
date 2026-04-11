import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { useTasks, useReorderTasks, useCreateTask, useDeleteTask, useBatchCIStatus, useArchiveApproved } from "@/hooks";
import { useAppStore } from "@/stores/appStore";
import { useCreateTerminalSession, useBatchResolve, useBatchResolveStatus, useCancelBatchResolve } from "@/hooks/useTerminal";
import type { CICheckResult } from "@vibe-kanban/shared";
import { useConfirm } from "@/hooks/useConfirm";
import { api } from "@/lib/api";
import { PAGE_SIZE } from "@/lib/constants";
import { Loader2, Minus, Plus, GitBranch, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import KanbanColumn from "./KanbanColumn";
import KanbanToolbar from "./KanbanToolbar";
import ListView from "./ListView";
import TaskCard from "@/components/tasks/TaskCard";
import TaskEditorDialog from "@/components/tasks/TaskEditorDialog";
import TaskViewerDialog from "@/components/tasks/TaskViewerDialog";
import BranchSelector from "@/components/git/BranchSelector";
import type { Task, TaskStatus, TaskFilters } from "@vibe-kanban/shared";

interface KanbanBoardProps {
  projectId: string;
  projectName?: string;
}

const COLUMN_STATUS_MAP: Record<string, TaskStatus> = {
  inbox: "backlog",
  in_progress: "in_progress",
  done: "done",
  approved: "approved",
};

export default function KanbanBoard({ projectId, projectName }: KanbanBoardProps) {
  const { activeMilestones } = useAppStore();
  const milestoneId = activeMilestones[projectId] ?? undefined;

  const [sort, setSort] = useState<string>("priority");
  const [search, setSearch] = useState("");
  const [listView, setListView] = useState(false);
  const [inboxLimit, setInboxLimit] = useState(PAGE_SIZE);
  const [ipLimit, setIpLimit] = useState(PAGE_SIZE);
  const [doneLimit, setDoneLimit] = useState(PAGE_SIZE);
  const [approvedLimit, setApprovedLimit] = useState(PAGE_SIZE);

  // Task dialogs
  const [editorOpen, setEditorOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // DnD
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const reorderTasks = useReorderTasks();

  const baseFilters: Partial<TaskFilters> = {
    milestoneId: milestoneId ?? undefined,
    search: search || undefined,
    sort: sort as TaskFilters["sort"],
  };

  const { data: inboxData } = useTasks(projectId, { ...baseFilters, status: "backlog" as TaskStatus, limit: inboxLimit });
  const { data: todoData } = useTasks(projectId, { ...baseFilters, status: "todo" as TaskStatus, limit: inboxLimit });
  const { data: ipData } = useTasks(projectId, { ...baseFilters, status: "in_progress" as TaskStatus, limit: ipLimit });
  const { data: doneData } = useTasks(projectId, { ...baseFilters, status: "done" as TaskStatus, limit: doneLimit });
  const { data: approvedData } = useTasks(projectId, { ...baseFilters, status: "approved" as TaskStatus, limit: approvedLimit });

  const inboxTasks = useMemo(() => [
    ...(inboxData?.items ?? []),
    ...(todoData?.items ?? []),
  ], [inboxData, todoData]);
  const inboxTotal = (inboxData?.total ?? 0) + (todoData?.total ?? 0);

  const ipTasks = ipData?.items ?? [];
  const doneTasks = doneData?.items ?? [];
  const approvedTasks = approvedData?.items ?? [];

  const allTasks = useMemo(() => [...inboxTasks, ...ipTasks, ...doneTasks, ...approvedTasks], [inboxTasks, ipTasks, doneTasks, approvedTasks]);

  // CI/CD status: collect unique branches and batch-query
  const allBranches = useMemo(() => {
    const branches = new Set<string>();
    for (const t of allTasks) {
      if (t.branch) branches.add(t.branch);
    }
    return [...branches];
  }, [allTasks]);

  const { data: ciResults } = useBatchCIStatus(projectId, allBranches);
  const ciMap = useMemo(() => {
    const map = new Map<string, CICheckResult>();
    if (ciResults) {
      for (const r of ciResults) {
        map.set(r.branch, r);
      }
    }
    return map;
  }, [ciResults]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const findTask = useCallback((id: string) => allTasks.find((t) => t.id === id), [allTasks]);

  const handleDragStart = (event: DragStartEvent) => {
    const task = findTask(String(event.active.id));
    setActiveTask(task ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const overId = String(over.id);

    // Determine target column
    let targetColumn: string | null = null;
    if (["inbox", "in_progress", "done", "approved"].includes(overId)) {
      targetColumn = overId;
    } else {
      // Dropped on another task — find which column that task is in
      const overTask = findTask(overId);
      if (overTask) {
        if (overTask.status === "backlog" || overTask.status === "todo") targetColumn = "inbox";
        else if (overTask.status === "in_progress") targetColumn = "in_progress";
        else if (overTask.status === "done") targetColumn = "done";
        else if (overTask.status === "approved") targetColumn = "approved";
      }
    }

    if (!targetColumn) return;

    const newStatus = COLUMN_STATUS_MAP[targetColumn];
    const task = findTask(taskId);
    if (!task) return;

    const statusChanged = task.status !== newStatus && !(targetColumn === "inbox" && (task.status === "backlog" || task.status === "todo"));

    reorderTasks.mutate([{
      id: taskId,
      sortOrder: task.sortOrder,
      ...(statusChanged ? { status: newStatus } : {}),
    }]);
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setViewerOpen(true);
  };

  const handleNewTask = () => {
    setEditingTask(null);
    setEditorOpen(true);
  };

  const handleEditFromViewer = () => {
    setViewerOpen(false);
    setEditingTask(selectedTask);
    setEditorOpen(true);
  };

  const createTermSession = useCreateTerminalSession();
  const batchResolve = useBatchResolve();
  const { data: batchStatus } = useBatchResolveStatus();
  const cancelBatch = useCancelBatchResolve();
  const { toggleTerminal, terminalVisible } = useAppStore();

  const confirm = useConfirm();
  const batchRunning = batchStatus?.state === "running";
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchConcurrency, setBatchConcurrency] = useState(1);
  const [batchTaskIds, setBatchTaskIds] = useState<string[]>([]);
  const [batchOverrideBranch, setBatchOverrideBranch] = useState<string | null>(null);

  const handleBatchResolve = () => {
    const taskIds = [...inboxTasks, ...ipTasks].map((t) => t.id);
    if (taskIds.length === 0) return;
    setBatchTaskIds(taskIds);
    setBatchDialogOpen(true);
  };

  const handleBatchConfirm = () => {
    setBatchDialogOpen(false);
    if (!terminalVisible) toggleTerminal();
    batchResolve.mutate({
      projectId,
      taskIds: batchTaskIds,
      concurrency: batchConcurrency,
      overrideBranch: batchOverrideBranch ?? undefined,
    });
  };

  // Compute branch groups for batch dialog display
  const batchBranchGroups = useMemo(() => {
    const groups = new Map<string, number>();
    for (const id of batchTaskIds) {
      const task = allTasks.find((t) => t.id === id);
      const key = task?.branch || "(current branch)";
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    return groups;
  }, [batchTaskIds, allTasks]);

  const handleCancelBatch = () => {
    cancelBatch.mutate();
  };

  const handleAIResolve = async (task: Task) => {
    if (!terminalVisible) toggleTerminal();
    let prompt: string;
    try {
      const result = await api.tasks.aiResolvePrompt(task.projectId, task.id);
      prompt = result.prompt;
    } catch {
      const parts = [task.title];
      if (task.description) parts.push(task.description);
      if (task.prompt) parts.push(task.prompt);
      prompt = parts.join("\n\n");
    }
    createTermSession.mutate({
      type: "ai-resolve",
      projectId: task.projectId,
      prompt,
      taskId: task.id,
      name: task.title,
      branch: task.branch ?? undefined,
    });
  };

  const handleAnalyze = (task: Task) => {
    setSelectedTask(task);
    setViewerOpen(true);
  };

  const handleEditCard = (task: Task) => {
    setEditingTask(task);
    setEditorOpen(true);
  };

  const archiveApproved = useArchiveApproved(projectId);
  const cloneTask = useCreateTask(projectId);
  const deleteTaskMut = useDeleteTask();

  const handleClone = (task: Task) => {
    cloneTask.mutate({
      title: `${task.title} (copy)`,
      description: task.description ?? undefined,
      prompt: task.prompt ?? undefined,
      priority: task.priority,
      status: task.status,
      milestoneId: task.milestoneId ?? undefined,
    });
  };

  const handleDelete = async (task: Task) => {
    if (!await confirm({ title: "Delete Task", description: `Delete "${task.title}"?` })) return;
    deleteTaskMut.mutate(task.id);
  };

  const handleArchiveApproved = async () => {
    const count = approvedData?.total ?? 0;
    if (count === 0) return;
    if (!await confirm({ title: "Archive Approved", description: `Archive ${count} approved task${count !== 1 ? "s" : ""}? They will be hidden from the board but not deleted.` })) return;
    archiveApproved.mutate();
  };

  return (
    <div className="space-y-4">
      <KanbanToolbar
        projectId={projectId}
        sort={sort}
        onSortChange={setSort}
        search={search}
        onSearchChange={setSearch}
        listView={listView}
        onListViewChange={setListView}
        onNewTask={handleNewTask}
        onBatchResolve={handleBatchResolve}
        batchResolveRunning={batchRunning}
        projectName={projectName}
      />

      {batchStatus && batchStatus.state === "running" && (
        <div className="flex items-center gap-3 rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-2.5">
          <div className="h-6 w-6 rounded-full bg-purple-500/15 flex items-center justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">
              Resolving {batchStatus.completedTasks}/{batchStatus.totalTasks}
              {(batchStatus.concurrency ?? 1) > 1 && (
                <span className="text-muted-foreground font-normal ml-1.5">({batchStatus.activeTasks?.length ?? 0} active)</span>
              )}
            </div>
            {(batchStatus.concurrency ?? 1) <= 1 && batchStatus.currentTaskTitle && (
              <div className="text-xs text-muted-foreground truncate">{batchStatus.currentTaskTitle}</div>
            )}
            {(batchStatus.concurrency ?? 1) > 1 && batchStatus.activeTasks && batchStatus.activeTasks.length > 0 && (
              <div className="text-xs text-muted-foreground truncate">
                {batchStatus.activeTasks.map((t) => t.taskTitle).join(", ")}
              </div>
            )}
          </div>
          <div className="w-32 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full transition-all"
              style={{ width: `${(batchStatus.completedTasks / batchStatus.totalTasks) * 100}%` }}
            />
          </div>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleCancelBatch}>
            Cancel
          </Button>
        </div>
      )}

      {batchStatus && batchStatus.state === "completed" && batchStatus.totalTasks > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-2 text-sm">
          <span className="text-green-400">Batch resolve complete:</span>
          <span>{batchStatus.completedTasks}/{batchStatus.totalTasks} tasks processed</span>
        </div>
      )}

      {listView ? (
        <ListView tasks={allTasks} onTaskClick={handleTaskClick} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-5 overflow-x-auto pb-4">
            <KanbanColumn
              id="inbox"
              title="Inbox"
              tasks={inboxTasks}
              total={inboxTotal}
              projectId={projectId}
              defaultStatus="backlog"
              ciResults={ciMap}
              onTaskClick={handleTaskClick}
              onAIResolve={handleAIResolve}
              onAnalyze={handleAnalyze}
              onEdit={handleEditCard}
              onClone={handleClone}
              onDelete={handleDelete}
              hasMore={inboxTasks.length < inboxTotal}
              onLoadMore={() => setInboxLimit((l) => l + PAGE_SIZE)}
            />
            <KanbanColumn
              id="in_progress"
              title="In Progress"
              tasks={ipTasks}
              total={ipData?.total ?? 0}
              projectId={projectId}
              defaultStatus="in_progress"
              ciResults={ciMap}
              onTaskClick={handleTaskClick}
              onAIResolve={handleAIResolve}
              onAnalyze={handleAnalyze}
              onEdit={handleEditCard}
              onClone={handleClone}
              onDelete={handleDelete}
              hasMore={ipTasks.length < (ipData?.total ?? 0)}
              onLoadMore={() => setIpLimit((l) => l + PAGE_SIZE)}
            />
            <KanbanColumn
              id="done"
              title="Done"
              tasks={doneTasks}
              total={doneData?.total ?? 0}
              projectId={projectId}
              defaultStatus="done"
              ciResults={ciMap}
              onTaskClick={handleTaskClick}
              onAIResolve={handleAIResolve}
              onAnalyze={handleAnalyze}
              onEdit={handleEditCard}
              onClone={handleClone}
              onDelete={handleDelete}
              hasMore={doneTasks.length < (doneData?.total ?? 0)}
              onLoadMore={() => setDoneLimit((l) => l + PAGE_SIZE)}
            />
            <KanbanColumn
              id="approved"
              title="Approved"
              tasks={approvedTasks}
              total={approvedData?.total ?? 0}
              projectId={projectId}
              defaultStatus="approved"
              ciResults={ciMap}
              headerAction={
                (approvedData?.total ?? 0) > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground ml-1"
                    onClick={handleArchiveApproved}
                    disabled={archiveApproved.isPending}
                    title="Archive all approved tasks"
                  >
                    <Archive className="h-3 w-3 mr-1" />
                    Archive
                  </Button>
                ) : undefined
              }
              onTaskClick={handleTaskClick}
              onAIResolve={handleAIResolve}
              onAnalyze={handleAnalyze}
              onEdit={handleEditCard}
              onClone={handleClone}
              onDelete={handleDelete}
              hasMore={approvedTasks.length < (approvedData?.total ?? 0)}
              onLoadMore={() => setApprovedLimit((l) => l + PAGE_SIZE)}
            />
          </div>

          <DragOverlay>
            {activeTask && <TaskCard task={activeTask} className="shadow-xl shadow-primary/10 rotate-[2deg] ring-2 ring-primary/20" />}
          </DragOverlay>
        </DndContext>
      )}

      <TaskEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        projectId={projectId}
        task={editingTask}
      />

      <TaskViewerDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        task={selectedTask}
        onEdit={handleEditFromViewer}
      />

      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Batch AI Resolve</DialogTitle>
            <DialogDescription>
              Start AI Resolve for {batchTaskIds.length} task{batchTaskIds.length !== 1 ? "s" : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between py-2">
            <label className="text-sm font-medium">Concurrency</label>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setBatchConcurrency((c) => Math.max(1, c - 1))}
                disabled={batchConcurrency <= 1}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-8 text-center text-sm font-mono">{batchConcurrency}</span>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setBatchConcurrency((c) => Math.min(10, c + 1))}
                disabled={batchConcurrency >= 10}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {batchConcurrency === 1
              ? "Tasks will be processed one at a time."
              : `Up to ${batchConcurrency} tasks will be processed in parallel.`}
          </p>

          {/* Branch groups summary */}
          {batchBranchGroups.size > 1 && !batchOverrideBranch && (
            <div className="space-y-1.5 py-1">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5" />
                Branch Groups
              </label>
              {Array.from(batchBranchGroups).map(([branch, count]) => (
                <div key={branch} className="flex items-center justify-between text-xs px-1">
                  <span className="font-mono truncate">{branch}</span>
                  <span className="text-muted-foreground">{count} task{count !== 1 ? "s" : ""}</span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">
                Tasks processed branch-by-branch. Only same-branch tasks run concurrently.
              </p>
            </div>
          )}

          {/* Override branch for all */}
          <div className="space-y-1.5 py-1">
            <label className="text-sm font-medium">Override branch (optional)</label>
            <BranchSelector projectId={projectId} value={batchOverrideBranch} onSelect={setBatchOverrideBranch} />
            <p className="text-[11px] text-muted-foreground">
              Run all tasks on a specific branch instead of their assigned branches.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleBatchConfirm}>Start</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
