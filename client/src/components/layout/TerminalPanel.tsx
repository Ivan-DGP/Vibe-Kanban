import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import {
  useTerminalSessions,
  useCreateTerminalSession,
  useKillTerminalSession,
} from "@/hooks/useTerminal";
import { useProject } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Terminal, ChevronDown, ChevronUp } from "lucide-react";
import TerminalTabs from "@/components/terminal/TerminalTabs";
import IntegratedTerminal from "@/components/terminal/IntegratedTerminal";
import TerminalSplitView from "@/components/terminal/TerminalSplitView";
// Types used by child components via shared package

// localStorage key for tab state
const TABS_STORAGE_KEY = "vk-terminal-tabs";

interface TabState {
  activeSessionId: string | null;
  splitSessionId: string | null;
}

function loadTabState(): TabState {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { activeSessionId: null, splitSessionId: null };
}

function saveTabState(state: TabState) {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export default function TerminalPanel() {
  const { terminalVisible, toggleTerminal, terminalHeight, setTerminalHeight } = useAppStore();
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const { data: serverSessions = [], isLoading: sessionsLoading } = useTerminalSessions();
  const createSession = useCreateTerminalSession();
  const killSession = useKillTerminalSession();

  const [tabState, setTabState] = useState<TabState>(loadTabState);

  // Persist tab state
  useEffect(() => {
    saveTabState(tabState);
  }, [tabState]);

  // Listen for external focus requests (e.g. from WorkingOnBanner)
  useEffect(() => {
    const handleFocus = () => {
      const loaded = loadTabState();
      if (loaded.activeSessionId && loaded.activeSessionId !== tabState.activeSessionId) {
        setTabState((prev) => ({ ...prev, activeSessionId: loaded.activeSessionId }));
      }
    };
    window.addEventListener("terminal-focus-session", handleFocus);
    return () => window.removeEventListener("terminal-focus-session", handleFocus);
  }, [tabState.activeSessionId]);

  // Reconcile tabs with server sessions on mount / poll
  useEffect(() => {
    // Don't clear tab state while sessions are still loading —
    // the initial empty array would wipe the stored activeSessionId
    // before the server responds, breaking reconnection after refresh.
    if (sessionsLoading) return;

    if (serverSessions.length === 0) {
      if (tabState.activeSessionId) {
        setTabState({ activeSessionId: null, splitSessionId: null });
      }
      return;
    }

    const serverIds = new Set(serverSessions.map((s) => s.id));

    // If active tab no longer exists on server, pick first available
    let newActive = tabState.activeSessionId;
    if (!newActive || !serverIds.has(newActive)) {
      newActive = serverSessions[0]?.id ?? null;
    }

    // If split tab no longer exists on server, clear it
    let newSplit = tabState.splitSessionId;
    if (newSplit && !serverIds.has(newSplit)) {
      newSplit = null;
    }

    if (newActive !== tabState.activeSessionId || newSplit !== tabState.splitSessionId) {
      setTabState({ activeSessionId: newActive, splitSessionId: newSplit });
    }
  }, [serverSessions, sessionsLoading]);

  const handleNewSession = useCallback(async () => {
    if (!terminalVisible) toggleTerminal();
    const result = await createSession.mutateAsync({
      type: "shell",
      projectId,
    });
    setTabState((prev) => ({ ...prev, activeSessionId: result.id }));
  }, [projectId, terminalVisible, toggleTerminal, createSession]);

  const handleNewDevSession = useCallback(async () => {
    if (!project) return;
    if (!terminalVisible) toggleTerminal();
    const result = await createSession.mutateAsync({
      type: "dev",
      projectId,
      devCommand: "bun run dev",
    });
    setTabState((prev) => ({ ...prev, activeSessionId: result.id }));
  }, [project, projectId, terminalVisible, toggleTerminal, createSession]);

  // Launch a native interactive `claude` REPL directly — no picker. Model and
  // session (resume/continue) are handled via claude's own slash commands
  // inside the terminal, same as running `claude` in a shell.
  const handleNewClaudeSession = useCallback(async () => {
    if (!terminalVisible) toggleTerminal();
    const result = await createSession.mutateAsync({
      type: "claude-interactive",
      projectId,
      name: "Claude",
    });
    setTabState((prev) => ({ ...prev, activeSessionId: result.id }));
  }, [projectId, terminalVisible, toggleTerminal, createSession]);

  const handleKillSession = (id: string) => {
    killSession.mutate(id);
    setTabState((prev) => {
      const remaining = serverSessions.filter((s) => s.id !== id);
      const newActive =
        prev.activeSessionId === id
          ? (remaining[remaining.length - 1]?.id ?? null)
          : prev.activeSessionId;
      const newSplit = prev.splitSessionId === id ? null : prev.splitSessionId;
      return { activeSessionId: newActive, splitSessionId: newSplit };
    });
  };

  // Bulk-close a set of session ids, then reconcile active/split tabs against
  // whatever survives. Used by "close all", "close others", "close to the
  // right/left" — mirrors browser/IDE tab menus.
  const killSessions = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const toKill = new Set(ids);
      for (const id of ids) killSession.mutate(id);
      setTabState((prev) => {
        const survivors = serverSessions.filter((s) => !toKill.has(s.id));
        const newActive =
          prev.activeSessionId && toKill.has(prev.activeSessionId)
            ? (survivors[survivors.length - 1]?.id ?? null)
            : prev.activeSessionId;
        const newSplit =
          prev.splitSessionId && toKill.has(prev.splitSessionId) ? null : prev.splitSessionId;
        return { activeSessionId: newActive, splitSessionId: newSplit };
      });
    },
    [serverSessions, killSession],
  );

  const handleCloseAll = useCallback(
    () => killSessions(serverSessions.map((s) => s.id)),
    [killSessions, serverSessions],
  );

  const handleCloseOthers = useCallback(
    (keepId: string) =>
      killSessions(serverSessions.filter((s) => s.id !== keepId).map((s) => s.id)),
    [killSessions, serverSessions],
  );

  const handleCloseToRight = useCallback(
    (fromId: string) => {
      const idx = serverSessions.findIndex((s) => s.id === fromId);
      if (idx < 0) return;
      killSessions(serverSessions.slice(idx + 1).map((s) => s.id));
    },
    [killSessions, serverSessions],
  );

  const handleCloseToLeft = useCallback(
    (fromId: string) => {
      const idx = serverSessions.findIndex((s) => s.id === fromId);
      if (idx <= 0) return;
      killSessions(serverSessions.slice(0, idx).map((s) => s.id));
    },
    [killSessions, serverSessions],
  );

  const handleSetActive = useCallback((id: string) => {
    setTabState((prev) => ({ ...prev, activeSessionId: id }));
  }, []);

  if (!terminalVisible) {
    return (
      <div className="flex items-center border-t border-border/50 px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[11px] gap-1.5 px-2 text-muted-foreground/60 hover:text-foreground"
          onClick={toggleTerminal}
        >
          <Terminal className="h-3.5 w-3.5" />
          Terminal
          <ChevronUp className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  const { activeSessionId, splitSessionId } = tabState;

  return (
    <div
      className="flex flex-col border-t border-border/50 bg-background"
      style={{ height: `${terminalHeight}px` }}
    >
      {/* Drag handle to resize */}
      <div
        className="h-1 cursor-row-resize hover:bg-primary/30 transition-colors"
        onMouseDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startH = terminalHeight;
          const onMove = (ev: MouseEvent) => {
            const newH = Math.max(150, Math.min(600, startH - (ev.clientY - startY)));
            setTerminalHeight(newH);
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      />
      <div className="flex items-center border-b border-border/30 bg-muted/50">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={toggleTerminal}>
          <ChevronDown className="h-4 w-4" />
        </Button>
        <TerminalTabs
          sessions={serverSessions}
          activeSessionId={activeSessionId}
          onSetActive={handleSetActive}
          onKill={handleKillSession}
          onNewSession={handleNewSession}
          onNewDevSession={project ? handleNewDevSession : undefined}
          onNewClaudeSession={handleNewClaudeSession}
          onCloseAll={handleCloseAll}
          onCloseOthers={handleCloseOthers}
          onCloseToRight={handleCloseToRight}
          onCloseToLeft={handleCloseToLeft}
        />
      </div>

      <div className="flex-1 overflow-hidden">
        {serverSessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            <Button variant="outline" size="sm" onClick={handleNewSession}>
              <Terminal className="h-4 w-4 mr-1" />
              New Terminal
            </Button>
          </div>
        ) : activeSessionId && splitSessionId ? (
          <TerminalSplitView primarySessionId={activeSessionId} splitSessionId={splitSessionId} />
        ) : activeSessionId ? (
          <IntegratedTerminal key={activeSessionId} sessionId={activeSessionId} />
        ) : null}
      </div>
    </div>
  );
}
