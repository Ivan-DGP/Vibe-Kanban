import { Loader2, Image as ImageIcon, X, Sparkles } from "lucide-react";

interface TaskEditorArtifactListProps {
  pastedArtifacts: Array<{ id: string; filename: string; renaming: boolean }>;
  uploadPending: boolean;
  onRemove: (id: string) => void;
}

export default function TaskEditorArtifactList({
  pastedArtifacts,
  uploadPending,
  onRemove,
}: TaskEditorArtifactListProps) {
  if (!(uploadPending || pastedArtifacts.length > 0)) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {pastedArtifacts.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
        >
          <ImageIcon className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono truncate max-w-[200px]" title={a.filename}>
            {a.filename}
          </span>
          {a.renaming && <Sparkles className="h-3 w-3 text-blue-500 animate-pulse" />}
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Remove from list"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      {uploadPending && (
        <div className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="text-muted-foreground">Uploading screenshot…</span>
        </div>
      )}
    </div>
  );
}
