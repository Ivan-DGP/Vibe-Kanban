import { useState } from "react";
import { useFileList, useCreateFile, useRenameFile, useDeleteFile } from "@/hooks";
import { useConfirm } from "@/hooks/useConfirm";
import { Folder, FolderOpen, File, FileCode, FileJson, FileText, Image, ChevronRight, ChevronDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

const FILE_ICONS: Record<string, typeof File> = {
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode, py: FileCode, go: FileCode, rs: FileCode,
  json: FileJson,
  md: FileText, mdx: FileText, txt: FileText,
  png: Image, jpg: Image, jpeg: Image, gif: Image, svg: Image, webp: Image,
};

function getIcon(name: string, isDir: boolean, isOpen: boolean) {
  if (isDir) return isOpen ? FolderOpen : Folder;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] || File;
}

interface FileExplorerProps {
  projectId: string;
  onFileSelect: (filePath: string, fileName: string) => void;
}

function FileContextMenu({ projectId, path: filePath, isDir, children }: {
  projectId: string;
  path: string;
  isDir: boolean;
  children: React.ReactNode;
}) {
  const createFile = useCreateFile();
  const renameFile = useRenameFile();
  const deleteFile = useDeleteFile();
  const confirmDialog = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState<"file" | "directory" | null>(null);
  const [createName, setCreateName] = useState("");

  const dir = isDir ? filePath : filePath.split("/").slice(0, -1).join("/");
  const currentName = filePath.split("/").pop() ?? "";

  const handleRename = () => {
    if (!newName.trim()) return;
    const parentDir = filePath.split("/").slice(0, -1).join("/");
    const target = parentDir ? `${parentDir}/${newName.trim()}` : newName.trim();
    renameFile.mutate({ projectId, oldPath: filePath, newPath: target }, {
      onSuccess: () => setRenaming(false),
    });
  };

  const handleCreate = () => {
    if (!createName.trim() || !creating) return;
    const target = dir ? `${dir}/${createName.trim()}` : createName.trim();
    createFile.mutate({ projectId, filePath: target, type: creating }, {
      onSuccess: () => { setCreating(null); setCreateName(""); },
    });
  };

  const handleDelete = async () => {
    if (!await confirmDialog({ title: "Delete File", description: `Delete "${currentName}"?` })) return;
    deleteFile.mutate({ projectId, filePath });
  };

  if (renaming) {
    return (
      <Input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setRenaming(false); }}
        onBlur={() => setRenaming(false)}
        className="h-5 text-[11px] px-1 mx-1"
        autoFocus
      />
    );
  }

  if (creating) {
    return (
      <div className="px-1">
        {children}
        <Input
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(null); }}
          onBlur={() => setCreating(null)}
          placeholder={creating === "file" ? "filename.ts" : "folder-name"}
          className="h-5 text-[11px] px-1 ml-4 mt-0.5"
          autoFocus
        />
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onContextMenu={(e) => e.preventDefault()}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {isDir && (
          <>
            <DropdownMenuItem onClick={() => { setCreating("file"); setCreateName(""); }}>New File</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setCreating("directory"); setCreateName(""); }}>New Folder</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => { setRenaming(true); setNewName(currentName); }}>Rename</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onClick={handleDelete}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FileTreeNode({ projectId, dirPath, name, depth, onFileSelect }: {
  projectId: string;
  dirPath: string;
  name: string;
  depth: number;
  onFileSelect: (filePath: string, fileName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: children } = useFileList(projectId, open ? dirPath : undefined);
  const Icon = getIcon(name, true, open);

  return (
    <div>
      <FileContextMenu projectId={projectId} path={dirPath} isDir>
        <button
          className="flex items-center gap-1 w-full px-1 py-0.5 text-xs hover:bg-accent rounded"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          onClick={() => setOpen(!open)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </button>
      </FileContextMenu>
      {open && children?.map((entry) =>
        entry.type === "directory" ? (
          <FileTreeNode
            key={entry.path}
            projectId={projectId}
            dirPath={entry.path}
            name={entry.name}
            depth={depth + 1}
            onFileSelect={onFileSelect}
          />
        ) : (
          <FileContextMenu key={entry.path} projectId={projectId} path={entry.path} isDir={false}>
            <button
              className="flex items-center gap-1 w-full px-1 py-0.5 text-xs hover:bg-accent rounded"
              style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
              onClick={() => onFileSelect(entry.path, entry.name)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {(() => { const I = getIcon(entry.name, false, false); return <I className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />; })()}
              <span className="truncate">{entry.name}</span>
            </button>
          </FileContextMenu>
        )
      )}
    </div>
  );
}

export default function FileExplorer({ projectId, onFileSelect }: FileExplorerProps) {
  const { data: rootFiles } = useFileList(projectId);

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        {rootFiles?.map((entry) =>
          entry.type === "directory" ? (
            <FileTreeNode
              key={entry.path}
              projectId={projectId}
              dirPath={entry.path}
              name={entry.name}
              depth={0}
              onFileSelect={onFileSelect}
            />
          ) : (
            <FileContextMenu key={entry.path} projectId={projectId} path={entry.path} isDir={false}>
              <button
                className="flex items-center gap-1 w-full px-1 py-0.5 text-xs hover:bg-accent rounded"
                style={{ paddingLeft: "20px" }}
                onClick={() => onFileSelect(entry.path, entry.name)}
                onContextMenu={(e) => e.preventDefault()}
              >
                {(() => { const I = getIcon(entry.name, false, false); return <I className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />; })()}
                <span className="truncate">{entry.name}</span>
              </button>
            </FileContextMenu>
          )
        )}
      </div>
    </ScrollArea>
  );
}
