import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";
import { useCreateTerminalSession } from "@/hooks/useTerminal";
import { useAppStore } from "@/stores/appStore";
import { api } from "@/lib/api";
import type { Task, Project } from "@vibe-kanban/shared";

interface AIResolveButtonProps {
  task: Task;
  project?: Project;
}

export default function AIResolveButton({ task, project: _project }: AIResolveButtonProps) {
  const createSession = useCreateTerminalSession();
  const { toggleTerminal, terminalVisible } = useAppStore();

  const handleResolve = async () => {
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

    createSession.mutate({
      type: "ai-resolve",
      projectId: task.projectId,
      prompt,
      taskId: task.id,
      name: task.title,
      branch: task.branch ?? undefined,
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={handleResolve}>
      <Zap className="h-3.5 w-3.5 mr-1" />
      AI Resolve
    </Button>
  );
}
