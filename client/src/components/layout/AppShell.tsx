import { Outlet, NavLink } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { useProjects } from "@/hooks";
import { useEffect } from "react";
import TerminalPanel from "@/components/layout/TerminalPanel";
import CommandPalette from "@/components/overlays/CommandPalette";
import GlobalSearch from "@/components/overlays/GlobalSearch";
import FileContentSearch from "@/components/overlays/FileContentSearch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LayoutDashboard,
  ListTodo,
  Settings,
  BarChart3,
  ScrollText,
  HelpCircle,
  PanelLeftClose,
  PanelLeft,
  FolderKanban,
  Star,
  CheckSquare,
  Send,
  Beaker,
} from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/tasks", icon: ListTodo, label: "Tasks" },
  { to: "/todos", icon: CheckSquare, label: "Todo" },
  { to: "/api-client", icon: Send, label: "API Client" },
  { to: "/reports", icon: BarChart3, label: "Reports" },
  { to: "/benchmarks", icon: Beaker, label: "Benchmarks" },
  { to: "/logs", icon: ScrollText, label: "Logs" },
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/help", icon: HelpCircle, label: "Help" },
];

export default function AppShell() {
  const {
    sidebarCollapsed,
    toggleSidebar,
    setCommandPaletteOpen,
    setGlobalSearchOpen,
    setFileSearchOpen,
  } = useAppStore();
  const { data: projects } = useProjects();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
      if (e.ctrlKey && e.shiftKey && e.key === "G") {
        e.preventDefault();
        setFileSearchOpen(true);
      }
      // 1-9 tab switching for sidebar nav
      if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= navItems.length) {
          const target = navItems[num - 1];
          if (target && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
            window.location.href = target.to;
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setCommandPaletteOpen, setGlobalSearchOpen, setFileSearchOpen]);

  // Sort: favorites first, then alphabetical
  const sortedProjects = projects
    ? [...projects].sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
    : [];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-border/50 bg-sidebar text-sidebar-foreground transition-all duration-200 ${
          sidebarCollapsed ? "w-14" : "w-56"
        }`}
      >
          <div className="flex items-center gap-2 px-3 h-14 border-b border-sidebar-border/50">
            {!sidebarCollapsed && (
              <span className="font-bold text-sm tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                Vibe Kanban
              </span>
            )}
            <button
              onClick={toggleSidebar}
              className="ml-auto p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
            >
              {sidebarCollapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Projects list */}
          {sortedProjects.length > 0 && (
            <div className="border-b border-sidebar-border/50">
              {!sidebarCollapsed && (
                <div className="px-3 pt-3 pb-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Projects</span>
                </div>
              )}
              <ScrollArea className={sidebarCollapsed ? "max-h-[200px]" : "max-h-[240px]"}>
                <div className="px-2 py-1 space-y-0.5">
                  {sortedProjects.map((project) => (
                    <NavLink
                      key={project.id}
                      to={`/project/${project.id}`}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-all duration-150 ${
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        } ${sidebarCollapsed ? "justify-center px-0" : ""}`
                      }
                    >
                      <FolderKanban className="h-3.5 w-3.5 shrink-0" />
                      {!sidebarCollapsed && (
                        <>
                          <span className="truncate flex-1">{project.name}</span>
                          {project.favorite && <Star className="h-3 w-3 shrink-0 fill-yellow-500/70 text-yellow-500/70" />}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Main nav */}
          <nav className="flex-1 py-3 space-y-0.5 px-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  } ${sidebarCollapsed ? "justify-center px-0" : ""}`
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </NavLink>
            ))}
          </nav>

          {!sidebarCollapsed && (
            <div className="px-3 py-2.5 border-t border-sidebar-border/50 text-[11px] text-muted-foreground/60">
              <kbd className="px-1.5 py-0.5 rounded bg-sidebar-accent/50 text-[10px] font-mono">Ctrl+K</kbd>
              <span className="ml-1.5">Command Palette</span>
            </div>
          )}
      </aside>

      {/* Main content + Terminal */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
        <TerminalPanel />
      </div>

      {/* Overlays */}
      <CommandPalette />
      <GlobalSearch />
      <FileContentSearch />
    </div>
  );
}
