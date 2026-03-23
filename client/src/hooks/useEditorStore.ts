import { create } from "zustand";

interface EditorTab {
  filePath: string;
  fileName: string;
  content: string;
  originalContent: string;
  dirty: boolean;
  language: string;
}

interface EditorStore {
  tabs: EditorTab[];
  activeTabPath: string | null;
  openFile: (filePath: string, fileName: string, content: string, language: string) => void;
  closeFile: (filePath: string) => void;
  setActiveTab: (filePath: string) => void;
  updateContent: (filePath: string, content: string) => void;
  markClean: (filePath: string) => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabs: [],
  activeTabPath: null,

  openFile: (filePath, fileName, content, language) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.filePath === filePath);
    if (existing) {
      set({ activeTabPath: filePath });
      return;
    }
    set({
      tabs: [...tabs, { filePath, fileName, content, originalContent: content, dirty: false, language }],
      activeTabPath: filePath,
    });
  },

  closeFile: (filePath) => {
    const { tabs, activeTabPath } = get();
    const remaining = tabs.filter((t) => t.filePath !== filePath);
    const newActive = activeTabPath === filePath
      ? remaining[remaining.length - 1]?.filePath ?? null
      : activeTabPath;
    set({ tabs: remaining, activeTabPath: newActive });
  },

  setActiveTab: (filePath) => set({ activeTabPath: filePath }),

  updateContent: (filePath, content) => {
    set({
      tabs: get().tabs.map((t) =>
        t.filePath === filePath
          ? { ...t, content, dirty: content !== t.originalContent }
          : t,
      ),
    });
  },

  markClean: (filePath) => {
    set({
      tabs: get().tabs.map((t) =>
        t.filePath === filePath
          ? { ...t, originalContent: t.content, dirty: false }
          : t,
      ),
    });
  },
}));
