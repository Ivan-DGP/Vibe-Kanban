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
} from "@dnd-kit/core";
import {
  useTasks,
  useReorderTasks,
  useUpdateTask,
  useCreateTask,
  useDeleteTask,
  useBatchCIStatus,
  useArchiveApproved,
  useAiResolvePrompt,
  useSettings,
} from "@/hooks";
import { shouldGateApproval } from "@/lib/taskArtifacts";
import QuizDialog from "@/components/tasks/QuizDialog";
import { useAppStore } from "@/stores/appStore";
import {
  useCreateTerminalSession,
  useBatchResolve,
  useBatchResolveStatus,
  useCancelBatchResolve,
} from "@/hooks/useTerminal";
import type { CICheckResult } from "@vibe-kanban/shared";
import { useConfirm } from "@/hooks/useConfirm";
import { PAGE_SIZE } from "@/lib/constants";
import KanbanToolbar from "./KanbanToolbar";
import ListView from "./ListView";
import KanbanBoardColumns from "./KanbanBoardColumns";
import BatchStatusBanner from "./BatchStatusBanner";
import BatchResolveDialog from "./BatchResolveDialog";
import TaskCard from "@/components/tasks/TaskCard";
import TaskEditorDialog from "@/components/tasks/TaskEditorDialog";
import TaskViewerDialog from "@/components/tasks/TaskViewerDialog";
import type { Task, TaskStatus, TaskFilters, AiAgent } from "@vibe-kanban/shared";

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
  const [quizGateTask, setQuizGateTask] = useState<Task | null>(null);
  const reorderTasks = useReorderTasks();
  const updateTask = useUpdateTask();

  const baseFilters: Partial<TaskFilters> = {
    milestoneId: milestoneId ?? undefined,
    search: search || undefined,
    sort: sort as TaskFilters["sort"],
  };

  const { data: inboxData } = useTasks(projectId, {
    ...baseFilters,
    status: "backlog" as TaskStatus,
    limit: inboxLimit,
  });
  const { data: todoData } = useTasks(projectId, {
    ...baseFilters,
    status: "todo" as TaskStatus,
    limit: inboxLimit,
  });
  const { data: ipData } = useTasks(projectId, {
    ...baseFilters,
    status: "in_progress" as TaskStatus,
    limit: ipLimit,
  });
  const { data: doneData } = useTasks(projectId, {
    ...baseFilters,
    status: "done" as TaskStatus,
    limit: doneLimit,
  });
  const { data: approvedData } = useTasks(projectId, {
    ...baseFilters,
    status: "approved" as TaskStatus,
    limit: approvedLimit,
  });

  const inboxTasks = useMemo(
    () => [...(inboxData?.items ?? []), ...(todoData?.items ?? [])],
    [inboxData, todoData],
  );
  const inboxTotal = (inboxData?.total ?? 0) + (todoData?.total ?? 0);

  const ipTasks = ipData?.items ?? [];
  const doneTasks = doneData?.items ?? [];
  const approvedTasks = approvedData?.items ?? [];

  const allTasks = useMemo(
    () => [...inboxTasks, ...ipTasks, ...doneTasks, ...approvedTasks],
    [inboxTasks, ipTasks, doneTasks, approvedTasks],
  );

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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

    const statusChanged =
      task.status !== newStatus &&
      !(targetColumn === "inbox" && (task.status === "backlog" || task.status === "todo"));

    // Soft quiz gate: dropping into Approved with an unpassed quiz opens the
    // comprehension check instead of committing immediately.
    if (statusChanged && newStatus === "approved" && shouldGateApproval(task)) {
      setQuizGateTask(task);
      return;
    }

    reorderTasks.mutate([
      {
        id: taskId,
        sortOrder: task.sortOrder,
        ...(statusChanged ? { status: newStatus } : {}),
      },
    ]);
  };

  // Complete a gated approval: mark the quiz passed (for audit) if the user
  // confirmed, then move the task to Approved.
  const completeGatedApproval = useCallback(
    (markPassed: boolean) => {
      const task = quizGateTask;
      setQuizGateTask(null);
      if (!task) return;
      const metadata = { ...(task.metadata ?? {}) };
      if (markPassed) metadata.quizPassed = true;
      updateTask.mutate({ id: task.id, input: { status: "approved", metadata } });
    },
    [quizGateTask, updateTask],
  );

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
  const aiResolvePrompt = useAiResolvePrompt();
  const batchResolve = useBatchResolve();
  const { data: batchStatus } = useBatchResolveStatus();
  const cancelBatch = useCancelBatchResolve();
  const { data: settings } = useSettings();
  const { toggleTerminal, terminalVisible } = useAppStore();

  const confirm = useConfirm();
  const batchRunning = batchStatus?.state === "running";
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchConcurrency, setBatchConcurrency] = useState(1);
  const [batchTaskIds, setBatchTaskIds] = useState<string[]>([]);
  const [batchOverrideBranch, setBatchOverrideBranch] = useState<string | null>(null);
  // null = follow the global default; a value overrides it for this run only.
  const [batchAgentOverride, setBatchAgentOverride] = useState<AiAgent | null>(null);
  const effectiveBatchAgent: AiAgent = batchAgentOverride ?? settings?.aiAgent ?? "claude";

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
      agent: effectiveBatchAgent,
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
      const result = await aiResolvePrompt.mutateAsync({
        projectId: task.projectId,
        taskId: task.id,
      });
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
      metadata: task.metadata,
    });
  };

  const handleDelete = async (task: Task) => {
    if (!(await confirm({ title: "Delete Task", description: `Delete "${task.title}"?` }))) return;
    deleteTaskMut.mutate(task.id);
  };

  const handleArchiveApproved = async () => {
    const count = approvedData?.total ?? 0;
    if (count === 0) return;
    if (
      !(await confirm({
        title: "Archive Approved",
        description: `Archive ${count} approved task${count !== 1 ? "s" : ""}? They will be hidden from the board but not deleted.`,
      }))
    )
      return;
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

      <BatchStatusBanner status={batchStatus} onCancel={handleCancelBatch} />

      {listView ? (
        <ListView tasks={allTasks} onTaskClick={handleTaskClick} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <KanbanBoardColumns
            projectId={projectId}
            ciMap={ciMap}
            inboxTasks={inboxTasks}
            inboxTotal={inboxTotal}
            ipTasks={ipTasks}
            ipTotal={ipData?.total ?? 0}
            doneTasks={doneTasks}
            doneTotal={doneData?.total ?? 0}
            approvedTasks={approvedTasks}
            approvedTotal={approvedData?.total ?? 0}
            onTaskClick={handleTaskClick}
            onAIResolve={handleAIResolve}
            onAnalyze={handleAnalyze}
            onEdit={handleEditCard}
            onClone={handleClone}
            onDelete={handleDelete}
            onArchiveApproved={handleArchiveApproved}
            archiveApprovedPending={archiveApproved.isPending}
            onLoadMoreInbox={() => setInboxLimit((l) => l + PAGE_SIZE)}
            onLoadMoreIp={() => setIpLimit((l) => l + PAGE_SIZE)}
            onLoadMoreDone={() => setDoneLimit((l) => l + PAGE_SIZE)}
            onLoadMoreApproved={() => setApprovedLimit((l) => l + PAGE_SIZE)}
          />

          <DragOverlay>
            {activeTask && (
              <TaskCard
                task={activeTask}
                className="shadow-xl shadow-primary/10 rotate-[2deg] ring-2 ring-primary/20"
              />
            )}
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

      <QuizDialog
        projectId={projectId}
        task={quizGateTask}
        open={!!quizGateTask}
        onOpenChange={(o) => !o && setQuizGateTask(null)}
        onApprove={completeGatedApproval}
      />

      <BatchResolveDialog
        open={batchDialogOpen}
        onOpenChange={setBatchDialogOpen}
        projectId={projectId}
        taskCount={batchTaskIds.length}
        concurrency={batchConcurrency}
        onConcurrencyChange={setBatchConcurrency}
        branchGroups={batchBranchGroups}
        overrideBranch={batchOverrideBranch}
        onOverrideBranchChange={setBatchOverrideBranch}
        agent={effectiveBatchAgent}
        onAgentChange={setBatchAgentOverride}
        onConfirm={handleBatchConfirm}
      />
    </div>
  );
}
