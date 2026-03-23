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
import { useTasks, useReorderTasks, useCreateTask, useDeleteTask } from "@/hooks";
import { useAppStore } from "@/stores/appStore";
import { useCreateTerminalSession } from "@/hooks/useTerminal";
import { api } from "@/lib/api";
import { PAGE_SIZE } from "@/lib/constants";
import KanbanColumn from "./KanbanColumn";
import KanbanToolbar from "./KanbanToolbar";
import ListView from "./ListView";
import TaskCard from "@/components/tasks/TaskCard";
import TaskEditorDialog from "@/components/tasks/TaskEditorDialog";
import TaskViewerDialog from "@/components/tasks/TaskViewerDialog";
import type { Task, TaskStatus, TaskFilters } from "@vibe-kanban/shared";

interface KanbanBoardProps {
  projectId: string;
  projectName?: string;
}

const COLUMN_STATUS_MAP: Record<string, TaskStatus> = {
  inbox: "backlog",
  in_progress: "in_progress",
  done: "done",
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

  const inboxTasks = useMemo(() => [
    ...(inboxData?.items ?? []),
    ...(todoData?.items ?? []),
  ], [inboxData, todoData]);
  const inboxTotal = (inboxData?.total ?? 0) + (todoData?.total ?? 0);

  const ipTasks = ipData?.items ?? [];
  const doneTasks = doneData?.items ?? [];

  const allTasks = useMemo(() => [...inboxTasks, ...ipTasks, ...doneTasks], [inboxTasks, ipTasks, doneTasks]);

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
    if (["inbox", "in_progress", "done"].includes(overId)) {
      targetColumn = overId;
    } else {
      // Dropped on another task — find which column that task is in
      const overTask = findTask(overId);
      if (overTask) {
        if (overTask.status === "backlog" || overTask.status === "todo") targetColumn = "inbox";
        else if (overTask.status === "in_progress") targetColumn = "in_progress";
        else if (overTask.status === "done") targetColumn = "done";
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
  const { toggleTerminal, terminalVisible } = useAppStore();

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

  const handleDelete = (task: Task) => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    deleteTaskMut.mutate(task.id);
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
        projectName={projectName}
      />

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
              onTaskClick={handleTaskClick}
              onAIResolve={handleAIResolve}
              onAnalyze={handleAnalyze}
              onEdit={handleEditCard}
              onClone={handleClone}
              onDelete={handleDelete}
              hasMore={doneTasks.length < (doneData?.total ?? 0)}
              onLoadMore={() => setDoneLimit((l) => l + PAGE_SIZE)}
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
    </div>
  );
}
