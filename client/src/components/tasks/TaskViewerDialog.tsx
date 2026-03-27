import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Pencil, Trash2, Sparkles, Loader2, Zap, GitBranch } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useCreateTerminalSession } from "@/hooks/useTerminal";
import { useAppStore } from "@/stores/appStore";
import { useConfirm } from "@/hooks/useConfirm";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PriorityBadge from "./PriorityBadge";
import { STATUS_LABELS } from "@/lib/constants";
import { useDeleteTask } from "@/hooks";
import { formatDistanceToNow } from "date-fns";
import type { Task } from "@vibe-kanban/shared";

interface TaskViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
  onEdit?: () => void;
}

export default function TaskViewerDialog({ open, onOpenChange, task, onEdit }: TaskViewerDialogProps) {
  const deleteTask = useDeleteTask();
  const confirm = useConfirm();
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const createTermSession = useCreateTerminalSession();
  const { toggleTerminal, terminalVisible } = useAppStore();

  if (!task) return null;

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const prompt = `Analyze this task and provide insights:\nTitle: ${task.title}\nPriority: ${task.priority}\nStatus: ${task.status}\n${task.description ? `Description: ${task.description}` : ""}\n${task.prompt ? `Technical: ${task.prompt}` : ""}\n\nProvide: 1) Complexity estimate 2) Suggested approach 3) Potential risks`;
      const res = await api.claude.chat(prompt, task.projectId);
      const reader = res.body?.getReader();
      if (!reader) return;
      let text = "";
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            try { const d = JSON.parse(line.slice(6)); if (d.type === "delta" && d.text) text += d.text; } catch {}
          }
        }
      }
      setAnalysis(text);
    } catch { setAnalysis("Analysis failed — check Claude configuration."); }
    finally { setAnalyzing(false); }
  };

  const handleDelete = async () => {
    if (!await confirm({ title: "Delete Task", description: "Delete this task?" })) return;
    deleteTask.mutate(task.id, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-2">
            <DialogTitle className="flex-1">{task.title}</DialogTitle>
            <PriorityBadge priority={task.priority} />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <Badge variant="secondary">{STATUS_LABELS[task.status]}</Badge>
            {task.branch && (
              <Badge variant="outline" className="gap-1 font-mono text-[10px]">
                <GitBranch className="h-3 w-3" />
                {task.branch}
              </Badge>
            )}
            <span>Created {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}</span>
          </div>
        </DialogHeader>

        {(task.description || task.prompt) ? (
          <Tabs defaultValue={task.description ? "description" : "prompt"}>
            <TabsList className="w-full">
              {task.description && <TabsTrigger value="description" className="flex-1">Description</TabsTrigger>}
              {task.prompt && <TabsTrigger value="prompt" className="flex-1">Prompt</TabsTrigger>}
            </TabsList>
            {task.description && (
              <TabsContent value="description" className="mt-2 prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.description}</ReactMarkdown>
              </TabsContent>
            )}
            {task.prompt && (
              <TabsContent value="prompt" className="mt-2 prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.prompt}</ReactMarkdown>
              </TabsContent>
            )}
          </Tabs>
        ) : (
          <p className="text-sm text-muted-foreground italic">No description</p>
        )}

        <Separator />

        {/* Timestamps */}
        <div className="space-y-1 text-xs text-muted-foreground">
          {task.inboxAt && <div>Inbox: {new Date(task.inboxAt).toLocaleString()}</div>}
          {task.inProgressAt && <div>In Progress: {new Date(task.inProgressAt).toLocaleString()}</div>}
          {task.doneAt && <div>Done: {new Date(task.doneAt).toLocaleString()}</div>}
        </div>

        {/* AI Analysis */}
        {analysis && (
          <>
            <Separator />
            <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">AI Analysis</div>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
            </div>
          </>
        )}

        <div className="flex items-center gap-2 pt-2 flex-wrap">
          <Button variant="default" size="sm" onClick={async () => {
            if (!terminalVisible) toggleTerminal();
            let prompt: string;
            try {
              const result = await api.tasks.aiResolvePrompt(task.projectId, task.id);
              prompt = result.prompt;
            } catch {
              const parts = [task.title];
              if (task.description) parts.push(task.description);
              if (task.prompt) parts.push(task.prompt);
              prompt = parts.join("\n\n");
            }
            createTermSession.mutate({
              type: "ai-resolve",
              projectId: task.projectId,
              prompt,
              taskId: task.id,
              branch: task.branch ?? undefined,
            });
            onOpenChange(false);
          }}>
            <Zap className="h-3.5 w-3.5 mr-1" />
            AI Resolve
          </Button>
          <Button variant="outline" size="sm" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
            {analyzing ? "Analyzing..." : "Analyze"}
          </Button>
          {onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          )}
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
