import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FileSearch, Wand2, Image as ImageIcon, X, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateTask,
  useUpdateTask,
  useMilestones,
  useUploadArtifact,
  useUpdateArtifact,
} from "@/hooks";
import BranchSelector from "@/components/git/BranchSelector";
import GatherContextModal from "./GatherContextModal";
import { claudeChat } from "@/hooks/useClaude";
import type {
  Task,
  TaskStatus,
  TaskPriority,
  PromptProfile,
  CreateTaskInput,
  Artifact,
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
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              autoFocus
            />
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              <TabsTrigger value="description" className="flex-1">
                Description
              </TabsTrigger>
              <TabsTrigger value="prompt" className="flex-1">
                Prompt
              </TabsTrigger>
            </TabsList>
            <TabsContent value="description" className="mt-2">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Product/user-facing description..."
                className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm"
                rows={5}
              />
            </TabsContent>
            <TabsContent value="prompt" className="mt-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Technical details for AI implementation..."
                className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm"
                rows={5}
              />
            </TabsContent>
          </Tabs>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleGatherContext}
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
              onClick={handleImproveWriting}
              disabled={
                aiLoading !== null || (!title.trim() && !description.trim() && !prompt.trim())
              }
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

          {(uploadArtifact.isPending || pastedArtifacts.length > 0) && (
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
                    onClick={() => handleRemovePastedArtifact(a.id)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Remove from list"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {uploadArtifact.isPending && (
                <div className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-muted-foreground">Uploading screenshot…</span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">Inbox</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Milestone</Label>
              <Select value={milestoneId} onValueChange={setMilestoneId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">General</SelectItem>
                  {milestones?.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Branch</Label>
              <BranchSelector projectId={projectId} value={branch} onSelect={setBranch} />
            </div>
            <div className="space-y-2">
              <Label>AI Profile</Label>
              <Select
                value={promptProfile}
                onValueChange={(v) => setPromptProfile(v as PromptProfile)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  <SelectItem value="quick-fix">Quick Fix</SelectItem>
                  <SelectItem value="feature">Feature</SelectItem>
                  <SelectItem value="refactor">Refactor</SelectItem>
                  <SelectItem value="bug-fix">Bug Fix</SelectItem>
                  <SelectItem value="docs">Documentation</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="space-y-1">
              <Label className="text-sm">Auto-spawn type</Label>
              <Select
                value={spawnType || "__none__"}
                onValueChange={(v) =>
                  setSpawnType(v === "__none__" ? "" : (v as "qa-test" | "dev-fix"))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (manual task)</SelectItem>
                  <SelectItem value="qa-test">qa-test — run browser QA via qa-agent</SelectItem>
                  <SelectItem value="dev-fix">dev-fix — Claude session writes the code</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Triggers a headless Claude session when the task is created. Project must have
                auto-spawn enabled.
              </p>
            </div>
            {spawnType === "qa-test" && (
              <div className="space-y-1 pt-1">
                <Label className="text-xs">Target URL</Label>
                <Input
                  value={qaTargetUrl}
                  onChange={(e) => setQaTargetUrl(e.target.value)}
                  placeholder="https://app.example.com/page"
                  className="h-8 text-xs font-mono"
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !title.trim()}>
            {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isEditing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
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
