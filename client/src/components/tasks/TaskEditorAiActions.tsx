import { Button } from "@/components/ui/button";
import { Loader2, FileSearch, Wand2 } from "lucide-react";

interface TaskEditorAiActionsProps {
  aiLoading: "context" | "improve" | null;
  title: string;
  description: string;
  prompt: string;
  gatherModalOpen: boolean;
  onGatherContext: () => void;
  onImproveWriting: () => void;
}

export default function TaskEditorAiActions({
  aiLoading,
  title,
  description,
  prompt,
  gatherModalOpen,
  onGatherContext,
  onImproveWriting,
}: TaskEditorAiActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1"
        onClick={onGatherContext}
        disabled={aiLoading !== null || !title.trim() || gatherModalOpen}
      >
        <FileSearch className="h-3 w-3" />
        Gather Context
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1"
        onClick={onImproveWriting}
        disabled={aiLoading !== null || (!title.trim() && !description.trim() && !prompt.trim())}
      >
        {aiLoading === "improve" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Wand2 className="h-3 w-3" />
        )}
        AI Improve Writing
      </Button>
      <span className="text-[10px] text-muted-foreground ml-auto">
        Paste a screenshot to attach
      </span>
    </div>
  );
}
