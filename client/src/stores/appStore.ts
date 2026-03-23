import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppStore {
  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Overlays
  commandPaletteOpen: boolean;
  globalSearchOpen: boolean;
  fileSearchOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  setGlobalSearchOpen: (open: boolean) => void;
  setFileSearchOpen: (open: boolean) => void;

  // Terminal panel
  terminalVisible: boolean;
  terminalHeight: number;
  toggleTerminal: () => void;
  setTerminalHeight: (h: number) => void;

  // Onboarding
  onboardingComplete: boolean;
  setOnboardingComplete: (v: boolean) => void;

  // Workspace mode per project
  workspaceModes: Record<string, "tasks" | "editor">;
  setWorkspaceMode: (projectId: string, mode: "tasks" | "editor") => void;

  // Active milestone per project
  activeMilestones: Record<string, string | null>;
  setActiveMilestone: (projectId: string, milestoneId: string | null) => void;

}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      commandPaletteOpen: false,
      globalSearchOpen: false,
      fileSearchOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setGlobalSearchOpen: (open) => set({ globalSearchOpen: open }),
      setFileSearchOpen: (open) => set({ fileSearchOpen: open }),

      terminalVisible: false,
      terminalHeight: 300,
      toggleTerminal: () =>
        set((s) => ({ terminalVisible: !s.terminalVisible })),
      setTerminalHeight: (h) => set({ terminalHeight: h }),

      onboardingComplete: false,
      setOnboardingComplete: (v) => set({ onboardingComplete: v }),

      workspaceModes: {},
      setWorkspaceMode: (projectId, mode) =>
        set((s) => ({
          workspaceModes: { ...s.workspaceModes, [projectId]: mode },
        })),

      activeMilestones: {},
      setActiveMilestone: (projectId, milestoneId) =>
        set((s) => ({
          activeMilestones: { ...s.activeMilestones, [projectId]: milestoneId },
        })),

    }),
    {
      name: "vibe-kanban-app",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        terminalHeight: state.terminalHeight,
        onboardingComplete: state.onboardingComplete,
        workspaceModes: state.workspaceModes,
        activeMilestones: state.activeMilestones,
      }),
    },
  ),
);
