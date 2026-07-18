import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect, useMemo } from "react";
import { claudeAnalyze, claudeChat } from "@/hooks/useClaude";
import { useCreateTerminalSession } from "@/hooks/useTerminal";
import { useTaskImpact } from "@/hooks/useGraph";
import { useAppStore } from "@/stores/appStore";
import { useConfirm } from "@/hooks/useConfirm";
import GatherContextModal from "./GatherContextModal";
import InterviewPanel from "@/components/ai/InterviewPanel";
import TaskAiRuns from "./TaskAiRuns";
import TaskViewerHeader from "./TaskViewerHeader";
import TaskViewerContent from "./TaskViewerContent";
import TaskViewerTimestamps from "./TaskViewerTimestamps";
import TaskViewerSubtasks from "./TaskViewerSubtasks";
import TaskViewerAnalysis from "./TaskViewerAnalysis";
import TaskViewerPreflight from "./TaskViewerPreflight";
import TaskViewerPastedArtifacts from "./TaskViewerPastedArtifacts";
import TaskViewerActions from "./TaskViewerActions";
import {
  useDeleteTask,
  useUpdateTask,
  useUploadArtifact,
  useUpdateArtifact,
  useAiResolvePrompt,
  useAiPreflight,
  useDecomposeTask,
} from "@/hooks";
import { toast } from "sonner";
import type { Task, AiPreflightResult, Artifact } from "@vibe-kanban/shared";

const FILE_PATH_RE = /[\w./-]+\.(?:tsx?|jsx?)/g;

function extractCandidateFiles(task: Task): string[] {
  const text = [task.title, task.description, task.prompt].filter(Boolean).join("\n");
  const matches = text.match(FILE_PATH_RE) ?? [];
  return [...new Set(matches)];
}

/** Compact blast-radius line for files mentioned in the task text. */
function TaskImpactSection({ task }: { task: Task }) {
  const files = useMemo(
    () => extractCandidateFiles(task),
    [task.title, task.description, task.prompt],
  );
  const { data } = useTaskImpact(task.projectId, files);
  if (!data || data.transitiveDependents === 0) return null;

  return (
    <div className="text-xs text-muted-foreground">
      <details>
        <summary className="cursor-pointer hover:text-foreground list-none [&::-webkit-details-marker]:hidden">
          Impact: {data.transitiveDependents} file{data.transitiveDependents === 1 ? "" : "s"}{" "}
          depend on this ({data.directDependents} direct)
        </summary>
        {data.top.length > 0 && (
          <ul className="mt-1 ml-1 space-y-0.5 border-l border-border pl-2">
            {data.top.map((t) => (
              <li key={t.file} className="font-mono truncate" title={t.file}>
                {t.file}
                {t.dependents > 0 ? ` · ${t.dependents}` : ""}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function slugifyForFilename(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40) || "screenshot"
  );
}

interface TaskViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
  onEdit?: () => void;
}

export default function TaskViewerDialog({
  open,
  onOpenChange,
  task,
  onEdit,
}: TaskViewerDialogProps) {
  const deleteTask = useDeleteTask();
  const updateTask = useUpdateTask();
  const confirm = useConfirm();
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [preflight, setPreflight] = useState<AiPreflightResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [decomposing, setDecomposing] = useState(false);
  const [gatherModalOpen, setGatherModalOpen] = useState(false);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [pastedArtifacts, setPastedArtifacts] = useState<
    Array<{ id: string; filename: string; renaming: boolean }>
  >([]);
  const createTermSession = useCreateTerminalSession();
  const { toggleTerminal, terminalVisible } = useAppStore();
  const uploadArtifact = useUploadArtifact(task?.projectId ?? "");
  const updateArtifact = useUpdateArtifact(task?.projectId ?? "");
  const aiResolvePrompt = useAiResolvePrompt();
  const aiPreflight = useAiPreflight();
  const decomposeTask = useDecomposeTask();

  useEffect(() => {
    if (!open) setPastedArtifacts([]);
  }, [open, task?.id]);

  if (!task) return null;

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await claudeAnalyze(task.projectId, task.id);
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
            try {
              const d = JSON.parse(line.slice(6));
              if (d.type === "delta" && d.text) text += d.text;
            } catch {}
          }
        }
      }
      setAnalysis(text);
    } catch {
      setAnalysis("Analysis failed — check Claude configuration.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDelete = async () => {
    if (!(await confirm({ title: "Delete Task", description: "Delete this task?" }))) return;
    deleteTask.mutate(task.id, { onSuccess: () => onOpenChange(false) });
  };

  const renameArtifactWithAI = async (artifact: Artifact) => {
    const ext = (artifact.filename.split(".").pop() || "png").toLowerCase();
    const parts: string[] = [`Task title: ${task.title}`];
    if (task.description) parts.push(`Description: ${task.description}`);
    if (task.prompt) parts.push(`Prompt: ${task.prompt}`);
    try {
      const aiPrompt = `Generate a short, descriptive filename for a screenshot attached to this task. Use kebab-case, 3-6 words, no extension, no path. Output ONLY the filename.\n\n${parts.join("\n")}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let raw = "";
      try {
        const res = await claudeChat(aiPrompt, task.projectId, controller.signal);
        if (!res.ok) throw new Error("AI request failed");
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No stream");
        let buffer = "";
        const decoder = new TextDecoder();
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const d = JSON.parse(line.slice(6));
                if (d.type === "delta" && d.text) raw += d.text;
                if (d.type === "done") break outer;
              } catch {
                /* ignore parse errors mid-chunk */
              }
            }
          }
        }
      } finally {
        clearTimeout(timeout);
      }
      const cleaned = raw
        .trim()
        .split("\n")[0]
        .replace(/\.[^.]*$/, "")
        .replace(/[^a-z0-9-]+/gi, "-")
        .toLowerCase()
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
      if (cleaned.length < 3) {
        setPastedArtifacts((prev) =>
          prev.map((a) => (a.id === artifact.id ? { ...a, renaming: false } : a)),
        );
        return;
      }
      const newFilename = `${cleaned}.${ext}`;
      updateArtifact.mutate(
        { id: artifact.id, input: { filename: newFilename } },
        {
          onSuccess: (updated) => {
            setPastedArtifacts((prev) =>
              prev.map((a) =>
                a.id === artifact.id
                  ? { id: updated.id, filename: updated.filename, renaming: false }
                  : a,
              ),
            );
          },
          onError: () => {
            setPastedArtifacts((prev) =>
              prev.map((a) => (a.id === artifact.id ? { ...a, renaming: false } : a)),
            );
          },
        },
      );
    } catch {
      setPastedArtifacts((prev) =>
        prev.map((a) => (a.id === artifact.id ? { ...a, renaming: false } : a)),
      );
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const ext = (blob.type.split("/")[1] || "png").split("+")[0];
        const baseName = slugifyForFilename(task.title);
        const file = new File([blob], `${baseName}-${Date.now()}.${ext}`, { type: blob.type });
        uploadArtifact.mutate(file, {
          onSuccess: (artifact) => {
            setPastedArtifacts((prev) => [
              ...prev,
              { id: artifact.id, filename: artifact.filename, renaming: true },
            ]);
            toast.success(`Saved as artifact: ${artifact.filename}`);
            renameArtifactWithAI(artifact);
          },
          onError: (err: any) => toast.error(err?.message || "Failed to upload screenshot"),
        });
        return;
      }
    }
  };

  const handleRemovePastedArtifact = (id: string) => {
    setPastedArtifacts((prev) => prev.filter((a) => a.id !== id));
  };

  const handleAiResolve = async () => {
    setResolving(true);
    try {
      // Run preflight check first
      const pf = await aiPreflight.mutateAsync({
        projectId: task.projectId,
        taskId: task.id,
      });
      setPreflight(pf);

      // If there are warnings, confirm with user
      if (pf.warnings.length > 0) {
        const proceed = await confirm({
          title: "AI Resolve Pre-flight",
          description: `${pf.warnings.join(". ")}. Continue anyway?`,
        });
        if (!proceed) {
          setResolving(false);
          return;
        }
      }

      // Proceed with resolve
      if (!terminalVisible) toggleTerminal();
      let prompt: string;
      try {
        const result = await aiResolvePrompt.mutateAsync({
          projectId: task.projectId,
          taskId: task.id,
        });
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
        // Per-task agent; undefined lets the server fall back to the global setting.
        agent: task.agent ?? undefined,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Pre-flight check failed");
    } finally {
      setResolving(false);
    }
  };

  const handleDecompose = async () => {
    setDecomposing(true);
    try {
      const result = await decomposeTask.mutateAsync({
        projectId: task.projectId,
        taskId: task.id,
      });
      toast.success(`Created ${result.subtasks.length} subtasks`);
    } catch (e: any) {
      toast.error(e.message || "Failed to decompose task");
    } finally {
      setDecomposing(false);
    }
  };

  const handleCopyContext = async () => {
    setCopying(true);
    try {
      const result = await aiResolvePrompt.mutateAsync({
        projectId: task.projectId,
        taskId: task.id,
      });
      await navigator.clipboard.writeText(result.prompt);
      toast.success("Context copied to clipboard");
    } catch {
      toast.error("Failed to copy context");
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" onPaste={handlePaste}>
        <TaskViewerHeader task={task} />

        <TaskViewerContent task={task} />

        <Separator />

        {/* Timestamps */}
        <TaskViewerTimestamps task={task} />

        <TaskImpactSection task={task} />

        {/* Subtasks */}
        <TaskViewerSubtasks projectId={task.projectId} parentTaskId={task.id} />

        {/* AI run history (status, duration, cost, cancel) */}
        <TaskAiRuns taskId={task.id} />

        {/* AI Analysis */}
        <TaskViewerAnalysis analysis={analysis} />

        {/* Pre-flight info */}
        <TaskViewerPreflight preflight={preflight} />

        <TaskViewerPastedArtifacts
          pastedArtifacts={pastedArtifacts}
          uploading={uploadArtifact.isPending}
          onRemove={handleRemovePastedArtifact}
        />

        <TaskViewerActions
          resolving={resolving}
          analyzing={analyzing}
          decomposing={decomposing}
          copying={copying}
          interviewOpen={interviewOpen}
          gatherModalOpen={gatherModalOpen}
          onEdit={onEdit}
          onAiResolve={handleAiResolve}
          onAnalyze={handleAnalyze}
          onDecompose={handleDecompose}
          onCopyContext={handleCopyContext}
          onInterview={() => setInterviewOpen(true)}
          onGather={() => setGatherModalOpen(true)}
          onDelete={handleDelete}
        />
      </DialogContent>

      <GatherContextModal
        open={gatherModalOpen}
        onOpenChange={setGatherModalOpen}
        taskTitle={task.title}
        taskDescription={task.description ?? undefined}
        projectId={task.projectId}
        onAccept={(text) => {
          updateTask.mutate(
            { id: task.id, input: { prompt: text } },
            {
              onSuccess: () => toast.success("Prompt updated from gathered context"),
              onError: (e: any) => toast.error(e.message || "Failed to update prompt"),
            },
          );
        }}
      />

      {interviewOpen && (
        <Dialog open={interviewOpen} onOpenChange={setInterviewOpen}>
          <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto p-0">
            <div className="h-[500px]">
              <InterviewPanel
                projectId={task.projectId}
                taskId={task.id}
                taskTitle={task.title}
                onClose={() => setInterviewOpen(false)}
                onFinalized={() => {
                  setInterviewOpen(false);
                  toast.success("Interview saved — answers will feed AI resolve");
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
