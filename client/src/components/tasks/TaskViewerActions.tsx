import { Button } from "@/components/ui/button";
import {
  Pencil,
  Trash2,
  Sparkles,
  Loader2,
  Zap,
  ClipboardCopy,
  Split,
  FileSearch,
  MessageSquareText,
} from "lucide-react";

interface TaskViewerActionsProps {
  resolving: boolean;
  analyzing: boolean;
  decomposing: boolean;
  copying: boolean;
  interviewOpen: boolean;
  gatherModalOpen: boolean;
  onEdit?: () => void;
  onAiResolve: () => void;
  onAnalyze: () => void;
  onDecompose: () => void;
  onCopyContext: () => void;
  onInterview: () => void;
  onGather: () => void;
  onDelete: () => void;
}

export default function TaskViewerActions({
  resolving,
  analyzing,
  decomposing,
  copying,
  interviewOpen,
  gatherModalOpen,
  onEdit,
  onAiResolve,
  onAnalyze,
  onDecompose,
  onCopyContext,
  onInterview,
  onGather,
  onDelete,
}: TaskViewerActionsProps) {
  return (
    <div className="flex items-center gap-2 pt-2 flex-wrap">
      <Button variant="default" size="sm" disabled={resolving} onClick={onAiResolve}>
        {resolving ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <Zap className="h-3.5 w-3.5 mr-1" />
        )}
        AI Resolve
      </Button>
      <Button variant="outline" size="sm" onClick={onAnalyze} disabled={analyzing}>
        {analyzing ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 mr-1" />
        )}
        {analyzing ? "Analyzing..." : "Analyze"}
      </Button>
      <Button variant="outline" size="sm" disabled={decomposing} onClick={onDecompose}>
        {decomposing ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <Split className="h-3.5 w-3.5 mr-1" />
        )}
        {decomposing ? "Breaking down..." : "Break Down"}
      </Button>
      <Button variant="outline" size="sm" disabled={copying} onClick={onCopyContext}>
        {copying ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <ClipboardCopy className="h-3.5 w-3.5 mr-1" />
        )}
        Copy Context
      </Button>
      <Button variant="outline" size="sm" onClick={onInterview} disabled={interviewOpen}>
        <MessageSquareText className="h-3.5 w-3.5 mr-1" />
        Interview me
      </Button>
      <Button variant="outline" size="sm" onClick={onGather} disabled={gatherModalOpen}>
        <FileSearch className="h-3.5 w-3.5 mr-1" />
        Gather Context
      </Button>
      {onEdit && (
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5 mr-1" />
          Edit
        </Button>
      )}
      <Button variant="destructive" size="sm" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5 mr-1" />
        Delete
      </Button>
    </div>
  );
}
