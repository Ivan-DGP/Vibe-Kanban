import { useState, useRef, useEffect, useCallback } from "react";
import { useArtifacts, useCreateArtifact, useUploadArtifact, useDeleteArtifact } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, FileText, Image, FlaskConical, FileCode, File, Trash2, Upload, Clipboard } from "lucide-react";
import type { Artifact, ArtifactType } from "@vibe-kanban/shared";
import ArtifactEditor from "./ArtifactEditor";

const TYPE_ICONS: Record<ArtifactType, typeof FileText> = {
  document: FileText,
  diagram: FileCode,
  image: Image,
  research: FlaskConical,
  spec: FileCode,
  other: File,
};

const TYPE_COLORS: Record<ArtifactType, string> = {
  document: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  diagram: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  image: "bg-green-500/10 text-green-400 border-green-500/20",
  research: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  spec: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  other: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

interface ArtifactsTabProps {
  projectId: string;
}

export default function ArtifactsTab({ projectId }: ArtifactsTabProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useArtifacts(projectId, {
    search: search || undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
  });
  const createArtifact = useCreateArtifact(projectId);
  const uploadArtifact = useUploadArtifact(projectId);
  const deleteArtifact = useDeleteArtifact(projectId);

  const handleUpload = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      uploadArtifact.mutate(file, {
        onSuccess: (artifact) => setSelectedArtifact(artifact),
      });
    });
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    // Don't intercept if user is typing in an input
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const ext = blob.type.split("/")[1] || "png";
        const file = new File([blob], `screenshot-${Date.now()}.${ext}`, { type: blob.type });
        uploadArtifact.mutate(file, {
          onSuccess: (artifact) => setSelectedArtifact(artifact),
        });
        return;
      }
    }
  }, [uploadArtifact]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleCreate = (type: ArtifactType) => {
    const extensions: Record<ArtifactType, string> = {
      document: ".md",
      diagram: ".md",
      image: ".png",
      research: ".md",
      spec: ".md",
      other: ".md",
    };
    const filename = `untitled${extensions[type]}`;
    createArtifact.mutate(
      { filename, type, content: `# New ${type}\n\n` },
      { onSuccess: (artifact) => setSelectedArtifact(artifact) },
    );
  };

  if (selectedArtifact) {
    return (
      <ArtifactEditor
        projectId={projectId}
        artifact={selectedArtifact}
        onBack={() => setSelectedArtifact(null)}
      />
    );
  }

  return (
    <div
      className="space-y-4 relative"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setIsDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleUpload(e.dataTransfer.files); }}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 border-2 border-dashed border-primary rounded-lg">
          <div className="text-center">
            <Upload className="h-10 w-10 mx-auto mb-2 text-primary" />
            <p className="text-sm font-medium">Drop files here to upload</p>
          </div>
        </div>
      )}
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search artifacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="document">Documents</SelectItem>
            <SelectItem value="diagram">Diagrams</SelectItem>
            <SelectItem value="image">Images</SelectItem>
            <SelectItem value="research">Research</SelectItem>
            <SelectItem value="spec">Specs</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-9 gap-1.5">
              <Plus className="h-4 w-4" />
              New
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleCreate("document")}>
              <FileText className="h-4 w-4 mr-2" /> Document
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleCreate("research")}>
              <FlaskConical className="h-4 w-4 mr-2" /> Research Note
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleCreate("spec")}>
              <FileCode className="h-4 w-4 mr-2" /> Spec
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleCreate("diagram")}>
              <FileCode className="h-4 w-4 mr-2" /> Diagram
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" /> Upload File
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigator.clipboard.read().then((items) => {
              for (const item of items) {
                const imageType = item.types.find((t) => t.startsWith("image/"));
                if (imageType) {
                  item.getType(imageType).then((blob) => {
                    const ext = imageType.split("/")[1] || "png";
                    const file = new File([blob], `screenshot-${Date.now()}.${ext}`, { type: imageType });
                    uploadArtifact.mutate(file, {
                      onSuccess: (artifact) => setSelectedArtifact(artifact),
                    });
                  });
                  return;
                }
              }
            }).catch(() => {})}>
              <Clipboard className="h-4 w-4 mr-2" /> Paste Screenshot
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept=".md,.txt,.json,.html,.css,.png,.jpg,.jpeg,.gif,.svg,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {/* Artifact list */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : !data?.items.length ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No artifacts yet</p>
          <p className="text-xs mt-1">Create docs, upload files, drag & drop, or paste screenshots (Ctrl+V)</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {data.items.map((artifact) => {
            const Icon = TYPE_ICONS[artifact.type] || File;
            return (
              <Card
                key={artifact.id}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => setSelectedArtifact(artifact)}
              >
                <div className={`p-1.5 rounded ${TYPE_COLORS[artifact.type]}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{artifact.filename}</p>
                  {artifact.description && (
                    <p className="text-xs text-muted-foreground truncate">{artifact.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {artifact.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                      {tag}
                    </Badge>
                  ))}
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatSize(artifact.sizeBytes)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteArtifact.mutate(artifact.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
