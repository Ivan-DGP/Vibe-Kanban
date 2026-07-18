import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Plus,
  X,
  Terminal,
  Play,
  Bot,
  Zap,
  FlaskConical,
  CheckCircle2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalSessionType, TerminalSessionInfo } from "@vibe-kanban/shared";

const SESSION_ICONS: Record<TerminalSessionType, typeof Terminal> = {
  shell: Terminal,
  dev: Play,
  "claude-ai": Bot,
  "ai-resolve": Zap,
  "ai-test": FlaskConical,
  "claude-interactive": Sparkles,
};

interface TerminalTabsProps {
  sessions: TerminalSessionInfo[];
  activeSessionId: string | null;
  onSetActive: (id: string) => void;
  onKill: (id: string) => void;
  onNewSession: () => void;
  onNewDevSession?: () => void;
  onNewClaudeSession?: () => void;
  onCloseAll?: () => void;
  onCloseOthers?: (keepId: string) => void;
  onCloseToRight?: (fromId: string) => void;
  onCloseToLeft?: (fromId: string) => void;
}

export default function TerminalTabs({
  sessions,
  activeSessionId,
  onSetActive,
  onKill,
  onNewSession,
  onNewDevSession,
  onNewClaudeSession,
  onCloseAll,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft,
}: TerminalTabsProps) {
  return (
    <div className="flex items-center gap-1 px-1 h-9 overflow-x-auto flex-1">
      {sessions.map((session, index) => {
        const Icon = SESSION_ICONS[session.type] || Terminal;
        const hasOthers = sessions.length > 1;
        const hasRight = index < sessions.length - 1;
        const hasLeft = index > 0;
        return (
          <ContextMenu key={session.id}>
            <ContextMenuTrigger asChild>
              <div
                role="tab"
                tabIndex={0}
                title={
                  session.claudeSessionId
                    ? `${session.model ? session.model + " · " : ""}session ${session.claudeSessionId}`
                    : undefined
                }
                onClick={() => onSetActive(session.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSetActive(session.id);
                }}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-sm transition-colors shrink-0 cursor-pointer",
                  activeSessionId === session.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                )}
              >
                {!session.alive ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
                <span className="max-w-[150px] truncate">
                  {session.name || `${session.type} ${session.id.slice(-6)}`}
                </span>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onKill(session.id);
                  }}
                  className="ml-1 p-1 rounded-sm hover:text-destructive hover:bg-destructive/10 transition-colors z-10 relative"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-48">
              <ContextMenuItem onClick={() => onKill(session.id)}>
                <X className="h-3.5 w-3.5 mr-2" /> Close
              </ContextMenuItem>
              {onCloseOthers && (
                <ContextMenuItem disabled={!hasOthers} onClick={() => onCloseOthers(session.id)}>
                  Close Others
                </ContextMenuItem>
              )}
              {onCloseToRight && (
                <ContextMenuItem disabled={!hasRight} onClick={() => onCloseToRight(session.id)}>
                  Close to the Right
                </ContextMenuItem>
              )}
              {onCloseToLeft && (
                <ContextMenuItem disabled={!hasLeft} onClick={() => onCloseToLeft(session.id)}>
                  Close to the Left
                </ContextMenuItem>
              )}
              {onCloseAll && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={onCloseAll}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Close All
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        );
      })}

      {onCloseAll && sessions.length > 1 && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          title="Close all terminals"
          onClick={onCloseAll}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title="New terminal session"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={onNewSession}>
            <Terminal className="h-3.5 w-3.5 mr-2" /> Shell
          </DropdownMenuItem>
          {onNewDevSession && (
            <DropdownMenuItem onClick={onNewDevSession}>
              <Play className="h-3.5 w-3.5 mr-2" /> Dev Server
            </DropdownMenuItem>
          )}
          {onNewClaudeSession && (
            <DropdownMenuItem onClick={onNewClaudeSession}>
              <Sparkles className="h-3.5 w-3.5 mr-2" /> Claude Terminal
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
