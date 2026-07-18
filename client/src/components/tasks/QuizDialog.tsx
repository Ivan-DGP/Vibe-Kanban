import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useArtifactContent } from "@/hooks";
import { getQuizArtifactId } from "@/lib/taskArtifacts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, GraduationCap } from "lucide-react";
import type { Task } from "@vibe-kanban/shared";

interface QuizDialogProps {
  projectId: string;
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Approve the task. `markPassed` records metadata.quizPassed for audit. */
  onApprove: (markPassed: boolean) => void;
}

/**
 * Soft comprehension-quiz gate shown when a task moves done→approved with an
 * unpassed quiz artifact attached. Renders the agent-authored quiz (markdown,
 * incl. its answer key) and lets the user either confirm they passed it or
 * approve anyway — the gate never hard-blocks.
 */
export default function QuizDialog({
  projectId,
  task,
  open,
  onOpenChange,
  onApprove,
}: QuizDialogProps) {
  const quizId = task ? getQuizArtifactId(task) : null;
  const { data, isLoading } = useArtifactContent(
    open && quizId ? projectId : undefined,
    quizId ?? undefined,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4" />
            Comprehension check before approving
          </DialogTitle>
          <DialogDescription>
            Review this quiz to confirm you understand what changed. Mark it passed to record that,
            or approve anyway to skip.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto rounded-md border p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading quiz...
            </div>
          ) : data?.content ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Quiz content unavailable.</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onApprove(false)}>
            Approve anyway
          </Button>
          <Button onClick={() => onApprove(true)}>Mark passed &amp; approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
