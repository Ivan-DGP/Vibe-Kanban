import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { useFileContent } from "@/hooks";
import { useEditorStore } from "@/hooks/useEditorStore";
import FileExplorer from "./FileExplorer";
import EditorTabs from "./EditorTabs";
import CodeEditorView from "./CodeEditorView";
import MarkdownPreview from "./MarkdownPreview";
import ImagePreview from "./ImagePreview";
import { Button } from "@/components/ui/button";
import { Eye, Code } from "lucide-react";
import { useState } from "react";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]);
const MD_EXTS = new Set(["md", "mdx"]);

interface CodeEditorPanelProps {
  projectId: string;
}

export default function CodeEditorPanel({ projectId }: CodeEditorPanelProps) {
  const { openFile, tabs, activeTabPath } = useEditorStore();
  const [previewMode, setPreviewMode] = useState(false);

  const activeTab = tabs.find((t) => t.filePath === activeTabPath);
  const ext = activeTab?.fileName.split(".").pop()?.toLowerCase() ?? "";
  const isImage = IMAGE_EXTS.has(ext);
  const isMd = MD_EXTS.has(ext);

  const handleFileSelect = async (filePath: string, fileName: string) => {
    // Check if already open
    const existing = tabs.find((t) => t.filePath === filePath);
    if (existing) {
      useEditorStore.getState().setActiveTab(filePath);
      return;
    }

    try {
      const { content, encoding } = await import("@/lib/api").then((m) => m.api.files.read(projectId, filePath));
      const fileExt = fileName.split(".").pop()?.toLowerCase() ?? "";
      openFile(filePath, fileName, content, fileExt);
    } catch {
      // File read failed
    }
  };

  return (
    <PanelGroup direction="horizontal">
      <Panel defaultSize={20} minSize={15} maxSize={40}>
        <div className="h-full border-r">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b">
            Explorer
          </div>
          <FileExplorer projectId={projectId} onFileSelect={handleFileSelect} />
        </div>
      </Panel>

      <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />

      <Panel minSize={30}>
        <div className="flex flex-col h-full">
          <div className="flex items-center">
            <div className="flex-1">
              <EditorTabs />
            </div>
            {activeTab && isMd && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 mr-1"
                onClick={() => setPreviewMode(!previewMode)}
              >
                {previewMode ? <Code className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-hidden">
            {activeTab && isImage ? (
              <ImagePreview content={activeTab.content} fileName={activeTab.fileName} />
            ) : activeTab && isMd && previewMode ? (
              <MarkdownPreview content={activeTab.content} />
            ) : (
              <CodeEditorView projectId={projectId} />
            )}
          </div>
        </div>
      </Panel>
    </PanelGroup>
  );
}
