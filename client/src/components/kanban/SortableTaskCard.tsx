import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import TaskCard from "@/components/tasks/TaskCard";
import type { Task } from "@vibe-kanban/shared";

interface SortableTaskCardProps {
  task: Task;
  onClick: () => void;
  onAIResolve?: () => void;
  onAnalyze?: () => void;
  onEdit?: () => void;
  onClone?: () => void;
  onDelete?: () => void;
}

export default function SortableTaskCard({ task, onClick, onAIResolve, onAnalyze, onEdit, onClone, onDelete }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    scale: isDragging ? "0.98" : "1",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard
        task={task}
        onClick={onClick}
        onAIResolve={onAIResolve}
        onAnalyze={onAnalyze}
        onEdit={onEdit}
        onClone={onClone}
        onDelete={onDelete}
      />
    </div>
  );
}
