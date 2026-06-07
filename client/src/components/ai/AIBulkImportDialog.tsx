import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Sparkles, Check, X } from "lucide-react";
import { useBulkImportAI, useBulkImportTasks } from "@/hooks";
import PriorityBadge from "@/components/tasks/PriorityBadge";
import type { CreateTaskInput } from "@vibe-kanban/shared";

interface AIBulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export default function AIBulkImportDialog({
  open,
  onOpenChange,
  projectId,
}: AIBulkImportDialogProps) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<CreateTaskInput[] | null>(null);
  const aiImport = useBulkImportAI(projectId);
  const bulkImport = useBulkImportTasks(projectId);

  const handleAnalyze = () => {
    if (!text.trim()) return;
    aiImport.mutate(text.trim(), {
      onSuccess: (tasks) => setParsed(tasks),
    });
  };

  const handleImport = () => {
    if (!parsed || parsed.length === 0) return;
    bulkImport.mutate(parsed, {
      onSuccess: () => {
        setText("");
        setParsed(null);
        onOpenChange(false);
      },
    });
  };

  const removeTask = (index: number) => {
    if (!parsed) return;
    setParsed(parsed.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Bulk Import
          </DialogTitle>
        </DialogHeader>

        {!parsed ? (
          <div className="space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste meeting notes, emails, bug reports, or any unstructured text..."
              className="w-full min-h-[200px] rounded-md border bg-background px-3 py-2 text-sm"
              rows={8}
            />
            <Button
              onClick={handleAnalyze}
              disabled={!text.trim() || aiImport.isPending}
              className="w-full"
            >
              {aiImport.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              Analyze with AI
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {parsed.length} task{parsed.length !== 1 ? "s" : ""} extracted. Review and import:
            </p>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {parsed.map((task, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 border rounded">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{task.title}</div>
                      {task.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                      )}
                      <div className="flex gap-1 mt-1">
                        {task.priority && <PriorityBadge priority={task.priority} />}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => removeTask(i)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          {parsed && (
            <>
              <Button variant="outline" onClick={() => setParsed(null)}>
                Back
              </Button>
              <Button onClick={handleImport} disabled={parsed.length === 0 || bulkImport.isPending}>
                {bulkImport.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Import {parsed.length} Tasks
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
