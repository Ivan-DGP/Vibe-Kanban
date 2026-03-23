import { useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { useEditorStore } from "@/hooks/useEditorStore";
import { useWriteFile } from "@/hooks";

const LANG_MAP: Record<string, () => ReturnType<typeof javascript>> = {
  ts: () => javascript({ typescript: true, jsx: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript({ jsx: true }),
  jsx: () => javascript({ jsx: true }),
  html: () => html(),
  css: () => css(),
  json: () => json(),
  md: () => markdown(),
  mdx: () => markdown(),
  py: () => python(),
};

interface CodeEditorViewProps {
  projectId: string;
}

export default function CodeEditorView({ projectId }: CodeEditorViewProps) {
  const { tabs, activeTabPath, updateContent, markClean } = useEditorStore();
  const writeFile = useWriteFile();

  const activeTab = tabs.find((t) => t.filePath === activeTabPath);

  const handleSave = useCallback(() => {
    if (!activeTab || !activeTab.dirty) return;
    writeFile.mutate(
      { projectId, filePath: activeTab.filePath, content: activeTab.content },
      { onSuccess: () => markClean(activeTab.filePath) },
    );
  }, [activeTab, projectId, writeFile, markClean]);

  if (!activeTab) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Open a file from the explorer
      </div>
    );
  }

  const ext = activeTab.fileName.split(".").pop()?.toLowerCase() ?? "";
  const langExt = LANG_MAP[ext];
  const extensions = langExt ? [langExt()] : [];

  return (
    <div
      className="h-full"
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === "s") {
          e.preventDefault();
          handleSave();
        }
      }}
    >
      <CodeMirror
        value={activeTab.content}
        height="100%"
        theme="dark"
        extensions={extensions}
        onChange={(value) => updateContent(activeTab.filePath, value)}
        className="h-full text-sm"
      />
    </div>
  );
}
