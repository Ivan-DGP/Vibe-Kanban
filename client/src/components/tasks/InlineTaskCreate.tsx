import { useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCreateTask } from "@/hooks";
import type { TaskStatus } from "@vibe-kanban/shared";

interface InlineTaskCreateProps {
  projectId: string;
  defaultStatus: TaskStatus;
}

export default function InlineTaskCreate({ projectId, defaultStatus }: InlineTaskCreateProps) {
  const [value, setValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const createTask = useCreateTask(projectId);

  const handleSubmit = () => {
    const title = value.trim();
    if (!title) return;
    createTask.mutate(
      { title, status: defaultStatus, priority: "medium" },
      { onSuccess: () => setValue("") },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      setValue("");
      setIsOpen(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent/50 rounded-lg transition-all border border-dashed border-transparent hover:border-border/40"
      >
        <Plus className="h-3.5 w-3.5" />
        Add task
      </button>
    );
  }

  return (
    <div className="px-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (!value.trim()) setIsOpen(false); }}
        placeholder="Task title... (Enter to add)"
        className="h-8 text-xs bg-background/50"
        autoFocus
      />
    </div>
  );
}
