import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, X, Terminal, Play, Bot, Zap, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalSessionType, TerminalSessionInfo } from "@vibe-kanban/shared";

const SESSION_ICONS: Record<TerminalSessionType, typeof Terminal> = {
  shell: Terminal,
  dev: Play,
  "claude-ai": Bot,
  "ai-resolve": Zap,
};

interface TerminalTabsProps {
  sessions: TerminalSessionInfo[];
  activeSessionId: string | null;
  onSetActive: (id: string) => void;
  onKill: (id: string) => void;
  onNewSession: () => void;
  onNewDevSession?: () => void;
}

export default function TerminalTabs({ sessions, activeSessionId, onSetActive, onKill, onNewSession, onNewDevSession }: TerminalTabsProps) {
  return (
    <div className="flex items-center gap-1 px-1 h-9 overflow-x-auto flex-1">
      {sessions.map((session) => {
        const Icon = SESSION_ICONS[session.type] || Terminal;
        return (
          <div
            key={session.id}
            role="tab"
            tabIndex={0}
            onClick={() => onSetActive(session.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSetActive(session.id); }}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-sm transition-colors shrink-0 cursor-pointer",
              activeSessionId === session.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50",
            )}
          >
            {!session.alive ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <Icon className="h-3 w-3" />}
            <span className="max-w-[150px] truncate">{session.name || `${session.type} ${session.id.slice(-6)}`}</span>
            <button
              type="button"
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
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
        );
      })}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
