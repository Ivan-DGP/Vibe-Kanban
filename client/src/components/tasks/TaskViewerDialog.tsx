import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Pencil, Trash2, Sparkles, Loader2, Zap, GitBranch, ClipboardCopy } from "lucide-react";
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
import { toast } from "sonner";
import type { Task, AiPreflightResult } from "@vibe-kanban/shared";

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
  const [preflight, setPreflight] = useState<AiPreflightResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [copying, setCopying] = useState(false);
  const createTermSession = useCreateTerminalSession();
  const { toggleTerminal, terminalVisible } = useAppStore();

  if (!task) return null;

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await api.claude.analyze(task.projectId, task.id);
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
            {task.promptProfile && task.promptProfile !== "auto" && (
              <Badge variant="outline" className="text-[10px]">
                {task.promptProfile}
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

        {/* Pre-flight info */}
        {preflight && (
          <>
            <Separator />
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{preflight.effectiveProfile}</Badge>
                <Badge variant={preflight.scope === "large" ? "default" : "secondary"}>{preflight.scope} scope</Badge>
                {preflight.detectedProfile !== preflight.effectiveProfile && (
                  <span className="text-muted-foreground">detected: {preflight.detectedProfile}</span>
                )}
              </div>
              {preflight.warnings.length > 0 && (
                <div className="space-y-0.5">
                  {preflight.warnings.map((w, i) => (
                    <p key={i} className="text-yellow-600 dark:text-yellow-400">{w}</p>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex items-center gap-2 pt-2 flex-wrap">
          <Button variant="default" size="sm" disabled={resolving} onClick={async () => {
            setResolving(true);
            try {
              // Run preflight check first
              const pf = await api.tasks.aiPreflight(task.projectId, task.id);
              setPreflight(pf);

              // If there are warnings, confirm with user
              if (pf.warnings.length > 0) {
                const proceed = await confirm({
                  title: "AI Resolve Pre-flight",
                  description: `${pf.warnings.join(". ")}. Continue anyway?`,
                });
                if (!proceed) { setResolving(false); return; }
              }

              // Proceed with resolve
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
            } catch (e: any) {
              toast.error(e.message || "Pre-flight check failed");
            } finally {
              setResolving(false);
            }
          }}>
            {resolving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
            AI Resolve
          </Button>
          <Button variant="outline" size="sm" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
            {analyzing ? "Analyzing..." : "Analyze"}
          </Button>
          <Button variant="outline" size="sm" disabled={copying} onClick={async () => {
            setCopying(true);
            try {
              const result = await api.tasks.aiResolvePrompt(task.projectId, task.id);
              await navigator.clipboard.writeText(result.prompt);
              toast.success("Context copied to clipboard");
            } catch {
              toast.error("Failed to copy context");
            } finally {
              setCopying(false);
            }
          }}>
            {copying ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ClipboardCopy className="h-3.5 w-3.5 mr-1" />}
            Copy Context
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
