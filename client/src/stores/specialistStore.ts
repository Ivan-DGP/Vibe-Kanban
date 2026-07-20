import { create } from "zustand";
import type { SpecialistSource } from "@vibe-kanban/shared";

/** One agentic MCP tool call, shown as an inline step while the model works. */
export interface ToolStep {
  name: string;
  summary?: string;
}

export interface SpecialistMsg {
  role: "user" | "assistant";
  content: string;
  sources?: SpecialistSource[];
  /** Agentic engine: the MCP tool calls the model made, in order. */
  steps?: ToolStep[];
  /** "agentic" | "grounded" — which engine answered. */
  engine?: string;
}

interface SpecialistState {
  messages: SpecialistMsg[];
  /** Mirrors React's setState: accepts a value or an updater. */
  setMessages: (updater: SpecialistMsg[] | ((prev: SpecialistMsg[]) => SpecialistMsg[])) => void;
  clear: () => void;
}

// Deliberately NOT persisted: the conversation should survive the panel being
// closed/reopened within a session (Radix Sheet unmounts its content), but not
// leak across full reloads. Keeping it in a store rather than the panel's local
// state is what preserves it across unmount.
export const useSpecialistStore = create<SpecialistState>((set) => ({
  messages: [],
  setMessages: (updater) =>
    set((s) => ({
      messages: typeof updater === "function" ? updater(s.messages) : updater,
    })),
  clear: () => set({ messages: [] }),
}));
