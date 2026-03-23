import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown, Undo2, Trash2, Loader2 } from "lucide-react";
import { usePush, usePull, useDiscard, useUndoCommit } from "@/hooks";

interface GitActionsProps {
  projectId: string;
  subPath?: string;
  selectedUnstaged: string[];
  ahead: number;
  behind: number;
}

export default function GitActions({ projectId, subPath, selectedUnstaged, ahead, behind }: GitActionsProps) {
  const push = usePush();
  const pull = usePull();
  const discard = useDiscard();
  const undoCommit = useUndoCommit();

  const handlePush = () => push.mutate({ projectId, subPath });
  const handlePull = () => pull.mutate({ projectId, subPath });

  const handleDiscard = () => {
    if (selectedUnstaged.length === 0) return;
    if (!confirm(`Discard changes to ${selectedUnstaged.length} file(s)?`)) return;
    discard.mutate({ projectId, files: selectedUnstaged, subPath });
  };

  const handleUndo = () => {
    if (!confirm("Undo the last commit? (soft reset)")) return;
    undoCommit.mutate({ projectId, subPath });
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handlePush} disabled={push.isPending}>
        {push.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ArrowUp className="h-3 w-3 mr-1" />}
        Push{ahead > 0 && ` (${ahead})`}
      </Button>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handlePull} disabled={pull.isPending}>
        {pull.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ArrowDown className="h-3 w-3 mr-1" />}
        Pull{behind > 0 && ` (${behind})`}
      </Button>
      {selectedUnstaged.length > 0 && (
        <Button variant="outline" size="sm" className="h-7 text-xs text-destructive" onClick={handleDiscard} disabled={discard.isPending}>
          <Trash2 className="h-3 w-3 mr-1" />
          Discard ({selectedUnstaged.length})
        </Button>
      )}
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleUndo} disabled={undoCommit.isPending}>
        <Undo2 className="h-3 w-3 mr-1" />
        Undo Commit
      </Button>
    </div>
  );
}
