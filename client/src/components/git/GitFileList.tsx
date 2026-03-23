import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { FileEdit, FilePlus, FileX, FileSymlink } from "lucide-react";
import type { FileChange } from "@vibe-kanban/shared";

const STATUS_ICONS: Record<string, typeof FileEdit> = {
  M: FileEdit,
  A: FilePlus,
  D: FileX,
  R: FileSymlink,
};

interface GitFileListProps {
  files: FileChange[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onFileClick?: (path: string) => void;
  type: "staged" | "unstaged";
}

export default function GitFileList({ files, selected, onToggle, onSelectAll, onDeselectAll, onFileClick, type }: GitFileListProps) {
  if (files.length === 0) return null;

  const allSelected = files.every((f) => selected.has(f.path));

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground uppercase tracking-wider">
          {type === "staged" ? "Staged" : "Changes"} ({files.length})
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 text-[10px] px-1.5"
          onClick={allSelected ? onDeselectAll : onSelectAll}
        >
          {allSelected ? "Deselect All" : "Select All"}
        </Button>
      </div>
      {files.map((file) => {
        const Icon = STATUS_ICONS[file.status] || FileEdit;
        return (
          <label
            key={file.path}
            className="flex items-center gap-2 px-1 py-0.5 rounded text-xs hover:bg-accent cursor-pointer"
          >
            <Checkbox
              checked={selected.has(file.path)}
              onCheckedChange={() => onToggle(file.path)}
              className="h-3.5 w-3.5"
            />
            <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span
              className="truncate flex-1 hover:underline"
              onClick={(e) => {
                if (onFileClick) {
                  e.preventDefault();
                  onFileClick(file.path);
                }
              }}
            >
              {file.path}
            </span>
            <span className="text-muted-foreground shrink-0">{file.status}</span>
          </label>
        );
      })}
    </div>
  );
}
