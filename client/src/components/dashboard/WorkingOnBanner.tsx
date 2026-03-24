import { useWorkingOn } from "@/hooks";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PRIORITY_COLORS } from "@/lib/constants";
import { useTerminalSessions } from "@/hooks/useTerminal";
import { useAppStore } from "@/stores/appStore";
import type { Task } from "@vibe-kanban/shared";

interface WorkingOnBannerProps {
  projectId?: string;
  compact?: boolean;
}

export default function WorkingOnBanner({ projectId, compact }: WorkingOnBannerProps) {
  const { data: tasks, isLoading } = useWorkingOn();
  const { data: sessions = [] } = useTerminalSessions();
  const navigate = useNavigate();
  const { toggleTerminal, terminalVisible } = useAppStore();

  if (isLoading) return null;

  const filteredTasks = projectId
    ? (tasks ?? []).filter((t: Task) => t.projectId === projectId)
    : (tasks ?? []);

  if (filteredTasks.length === 0) return null;

  const handleClick = (task: Task & { projectName?: string }) => {
    // Check if there's an existing terminal session for this task
    const taskSession = sessions.find((s) => s.taskId === task.id && s.alive);

    if (taskSession) {
      // Open terminal and focus the session
      if (!terminalVisible) toggleTerminal();
      // Store the session ID to focus in localStorage so TerminalPanel picks it up
      try {
        const tabState = JSON.parse(localStorage.getItem("vk-terminal-tabs") || "{}");
        tabState.activeSessionId = taskSession.id;
        localStorage.setItem("vk-terminal-tabs", JSON.stringify(tabState));
        // Dispatch storage event so TerminalPanel reacts
        window.dispatchEvent(new Event("terminal-focus-session"));
      } catch {}
    }

    // Navigate to project if not already there
    if (!projectId) {
      navigate(`/project/${task.projectId}`);
    }
  };

  return (
    <div className={compact ? "mb-4" : "mb-6 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4"}>
      <div className={`flex items-center gap-2 ${compact ? "mb-2" : "mb-3"}`}>
        <div className="h-6 w-6 rounded-full bg-blue-500/15 flex items-center justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
        </div>
        <span className="text-sm font-medium">Working On</span>
        <Badge variant="secondary" className="text-xs">{filteredTasks.length}</Badge>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {filteredTasks.map((task: Task & { projectName?: string }) => {
          const hasSession = sessions.some((s) => s.taskId === task.id && s.alive);
          return (
            <button
              key={task.id}
              onClick={() => handleClick(task)}
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-sm hover:bg-card hover:border-primary/30 transition-all shrink-0 group"
            >
              <span className={`h-2 w-2 rounded-full ${PRIORITY_COLORS[task.priority].split(" ")[0].replace("text-", "bg-")}`} />
              <span className="max-w-[200px] truncate font-medium">{task.title}</span>
              {!projectId && task.projectName && (
                <span className="text-xs text-muted-foreground">
                  {task.projectName}
                </span>
              )}
              {hasSession && (
                <Terminal className="h-3 w-3 text-blue-400" />
              )}
              <ArrowRight className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
