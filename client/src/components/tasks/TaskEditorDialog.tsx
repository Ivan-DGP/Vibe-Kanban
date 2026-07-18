import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  useCreateTask,
  useUpdateTask,
  useMilestones,
  useUploadArtifact,
  useUpdateArtifact,
} from "@/hooks";
import GatherContextModal from "./GatherContextModal";
import TaskEditorFields from "./TaskEditorFields";
import TaskEditorAiActions from "./TaskEditorAiActions";
import TaskEditorArtifactList from "./TaskEditorArtifactList";
import TaskEditorMetaFields from "./TaskEditorMetaFields";
import TaskEditorSpawnConfig from "./TaskEditorSpawnConfig";
import TaskEditorFooter from "./TaskEditorFooter";
import { claudeChat } from "@/hooks/useClaude";
import type {
  Task,
  TaskStatus,
  TaskPriority,
  PromptProfile,
  CreateTaskInput,
  Artifact,
  AiAgent,
} from "@vibe-kanban/shared";

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

interface TaskEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  task?: Task | null;
}

export default function TaskEditorDialog({
  open,
  onOpenChange,
  projectId,
  task,
}: TaskEditorDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [milestoneId, setMilestoneId] = useState<string>("none");
  const [branch, setBranch] = useState<string | null>(null);
  const [promptProfile, setPromptProfile] = useState<PromptProfile>("auto");
  const [agent, setAgent] = useState<AiAgent | null>(null);
  const [spawnType, setSpawnType] = useState<"" | "qa-test" | "dev-fix">("dev-fix");
  const [qaTargetUrl, setQaTargetUrl] = useState("");

  const [activeTab, setActiveTab] = useState("description");

  const createTask = useCreateTask(projectId);
  const updateTask = useUpdateTask();
  const uploadArtifact = useUploadArtifact(projectId);
  const updateArtifact = useUpdateArtifact(projectId);
  const { data: milestones } = useMilestones(projectId);
  const isEditing = !!task;
  const [aiLoading, setAiLoading] = useState<"context" | "improve" | null>(null);
  const [gatherModalOpen, setGatherModalOpen] = useState(false);
  const [pastedArtifacts, setPastedArtifacts] = useState<
    Array<{ id: string; filename: string; renaming: boolean }>
  >([]);

  const streamAI = async (systemPrompt: string): Promise<string> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await claudeChat(systemPrompt, projectId, controller.signal);
      if (!res.ok) throw new Error(`AI request failed (${res.status})`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      let text = "";
      let buffer = "";
      let streamDone = false;
      const decoder = new TextDecoder();
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const d = JSON.parse(line.slice(6));
              if (d.type === "delta" && d.text) text += d.text;
              if (d.type === "done") {
                streamDone = true;
                break;
              }
              if (d.type === "error") throw new Error(d.message || "AI error");
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }
      if (!text) throw new Error("No response from AI");
      return text;
    } finally {
      clearTimeout(timeout);
    }
  };

  const renameArtifactWithAI = async (artifact: Artifact) => {
    const ext = (artifact.filename.split(".").pop() || "png").toLowerCase();
    const parts: string[] = [];
    if (title.trim()) parts.push(`Task title: ${title}`);
    if (description.trim()) parts.push(`Description: ${description}`);
    if (prompt.trim()) parts.push(`Prompt: ${prompt}`);
    if (parts.length === 0) return;
    try {
      const aiPrompt = `Generate a short, descriptive filename for a screenshot attached to this task. Use kebab-case, 3-6 words, no extension, no path. Output ONLY the filename.\n\n${parts.join("\n")}`;
      const raw = await streamAI(aiPrompt);
      const cleaned = raw
        .trim()
        .split("\n")[0]
        .replace(/\.[^.]*$/, "")
        .replace(/[^a-z0-9-]+/gi, "-")
        .toLowerCase()
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
      if (cleaned.length < 3) return;
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
        const baseName = slugifyForFilename(title || "screenshot");
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

  const handleGatherContext = () => {
    if (!title.trim()) return;
    setGatherModalOpen(true);
  };

  const handleGatherContextAccept = (text: string) => {
    setPrompt(text);
    setActiveTab("prompt");
  };

  const handleImproveWriting = async () => {
    const text = description || prompt;
    if (!text.trim() && !title.trim()) return;
    setAiLoading("improve");
    try {
      const parts: string[] = [];
      if (title.trim()) parts.push(`Title: ${title}`);
      if (description.trim()) parts.push(`Description: ${description}`);
      else if (prompt.trim()) parts.push(`Prompt: ${prompt}`);

      const result = await streamAI(
        `Improve the writing of this task. Make it clearer, more structured, and actionable. Keep the same intent.${title.trim() && (description.trim() || prompt.trim()) ? `\nOutput format (use exactly these labels on separate lines):\nTitle: <improved title>\n${description.trim() ? "Description" : "Prompt"}: <improved text>` : title.trim() ? "\nOutput ONLY the improved title, no explanation." : `\nOutput ONLY the improved ${description ? "description" : "prompt"}, no explanation.`}\n\n${parts.join("\n")}`,
      );

      if (title.trim() && (description.trim() || prompt.trim())) {
        const titleMatch = result.match(/^Title:\s*(.+)/m);
        const bodyLabel = description.trim() ? "Description" : "Prompt";
        const bodyMatch = result.match(new RegExp(`^${bodyLabel}:\\s*([\\s\\S]*)`, "m"));
        if (titleMatch) setTitle(titleMatch[1].trim());
        if (bodyMatch) {
          if (description.trim()) setDescription(bodyMatch[1].trim());
          else setPrompt(bodyMatch[1].trim());
        }
      } else if (title.trim()) {
        setTitle(result.trim());
      } else {
        if (description) setDescription(result);
        else setPrompt(result);
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to improve writing");
    } finally {
      setAiLoading(null);
    }
  };

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setPrompt(task.prompt ?? "");
      setPriority(task.priority);
      setStatus(task.status);
      setMilestoneId(task.milestoneId ?? "none");
      setBranch(task.branch ?? null);
      setPromptProfile(task.promptProfile ?? "auto");
      setAgent(task.agent ?? null);
      const md = task.metadata ?? {};
      const t = (md as { type?: unknown }).type;
      setSpawnType(t === "qa-test" || t === "dev-fix" ? t : "");
      setQaTargetUrl(
        typeof (md as { qa_target_url?: unknown }).qa_target_url === "string"
          ? (md as { qa_target_url: string }).qa_target_url
          : "",
      );
    } else {
      setTitle("");
      setDescription("");
      setPrompt("");
      setPriority("medium");
      setStatus("todo");
      setMilestoneId("none");
      setBranch(null);
      setPromptProfile("auto");
      setAgent(null);
      setSpawnType("dev-fix");
      setQaTargetUrl("");
    }
    setActiveTab("description");
    setPastedArtifacts([]);
  }, [task, open]);

  const handleSubmit = () => {
    if (!title.trim()) return;

    const metadata: Record<string, unknown> = { ...(task?.metadata ?? {}) };
    if (spawnType) {
      metadata.type = spawnType;
      if (spawnType === "qa-test") {
        const trimmedUrl = qaTargetUrl.trim();
        if (trimmedUrl) metadata.qa_target_url = trimmedUrl;
        else delete metadata.qa_target_url;
      }
    } else {
      delete metadata.type;
    }

    const input: CreateTaskInput = {
      title: title.trim(),
      description: description.trim() || undefined,
      prompt: prompt.trim() || undefined,
      branch: branch || undefined,
      promptProfile,
      priority,
      status,
      milestoneId: milestoneId === "none" ? null : milestoneId,
      agent,
      metadata,
    };

    if (isEditing) {
      updateTask.mutate(
        { id: task.id, input: { ...input, branch } },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createTask.mutate(input, { onSuccess: () => onOpenChange(false) });
    }
  };

  const isPending = createTask.isPending || updateTask.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onPaste={handlePaste}>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Task" : "Create Task"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <TaskEditorFields
            title={title}
            onTitleChange={setTitle}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            description={description}
            onDescriptionChange={setDescription}
            prompt={prompt}
            onPromptChange={setPrompt}
          />

          <TaskEditorAiActions
            aiLoading={aiLoading}
            title={title}
            description={description}
            prompt={prompt}
            gatherModalOpen={gatherModalOpen}
            onGatherContext={handleGatherContext}
            onImproveWriting={handleImproveWriting}
          />

          <TaskEditorArtifactList
            pastedArtifacts={pastedArtifacts}
            uploadPending={uploadArtifact.isPending}
            onRemove={handleRemovePastedArtifact}
          />

          <TaskEditorMetaFields
            projectId={projectId}
            priority={priority}
            onPriorityChange={setPriority}
            status={status}
            onStatusChange={setStatus}
            milestoneId={milestoneId}
            onMilestoneChange={setMilestoneId}
            milestones={milestones}
            branch={branch}
            onBranchChange={setBranch}
            promptProfile={promptProfile}
            onPromptProfileChange={setPromptProfile}
            agent={agent}
            onAgentChange={setAgent}
          />

          <TaskEditorSpawnConfig
            spawnType={spawnType}
            onSpawnTypeChange={setSpawnType}
            qaTargetUrl={qaTargetUrl}
            onQaTargetUrlChange={setQaTargetUrl}
          />
        </div>

        <TaskEditorFooter
          isEditing={isEditing}
          isPending={isPending}
          title={title}
          onCancel={() => onOpenChange(false)}
          onSubmit={handleSubmit}
        />
      </DialogContent>

      <GatherContextModal
        open={gatherModalOpen}
        onOpenChange={setGatherModalOpen}
        taskTitle={title}
        taskDescription={description || undefined}
        projectId={projectId}
        onAccept={handleGatherContextAccept}
      />
    </Dialog>
  );
}
