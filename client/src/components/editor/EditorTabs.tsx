import { X } from "lucide-react";
import { useEditorStore } from "@/hooks/useEditorStore";
import { cn } from "@/lib/utils";

export default function EditorTabs() {
  const { tabs, activeTabPath, setActiveTab, closeFile } = useEditorStore();

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b overflow-x-auto bg-muted/30">
      {tabs.map((tab) => (
        <button
          key={tab.filePath}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs border-r shrink-0 transition-colors",
            activeTabPath === tab.filePath
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-background/50",
          )}
          onClick={() => setActiveTab(tab.filePath)}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              closeFile(tab.filePath);
            }
          }}
        >
          {tab.dirty && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />}
          <span>{tab.fileName}</span>
          <button
            className="ml-1 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              closeFile(tab.filePath);
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </button>
      ))}
    </div>
  );
}
