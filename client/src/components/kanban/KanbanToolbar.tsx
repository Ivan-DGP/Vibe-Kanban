import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Settings2,
  Plus,
  Download,
  Loader2,
  BarChart3,
  Zap,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import AIChatPanel from "@/components/ai/AIChatPanel";
import SupervisorPanel from "@/components/supervisor/SupervisorPanel";
import SpecialistChatPanel from "@/components/specialist/SpecialistChatPanel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { tasksToCSV, tasksToJSON, tasksToMarkdown, downloadFile } from "@/lib/task-export";
import { fetchProjectTasks } from "@/hooks/useTasks";
import { claudeChat } from "@/hooks/useClaude";
import TaskSortSelect from "@/components/tasks/TaskSortSelect";
import MilestoneSelector from "./MilestoneSelector";
import MilestoneManagerDialog from "./MilestoneManagerDialog";

interface KanbanToolbarProps {
  projectId: string;
  sort: string;
  onSortChange: (sort: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  listView: boolean;
  onListViewChange: (listView: boolean) => void;
  onNewTask: () => void;
  onBatchResolve?: () => void;
  batchResolveRunning?: boolean;
  projectName?: string;
}

export default function KanbanToolbar({
  projectId,
  sort,
  onSortChange,
  search,
  onSearchChange,
  listView,
  onListViewChange,
  onNewTask,
  onBatchResolve,
  batchResolveRunning,
  projectName,
}: KanbanToolbarProps) {
  const [milestoneManagerOpen, setMilestoneManagerOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [supervisorOpen, setSupervisorOpen] = useState(false);
  const [specialistOpen, setSpecialistOpen] = useState(false);
  const [sizeDialogOpen, setSizeDialogOpen] = useState(false);
  const [sizeLoading, setSizeLoading] = useState(false);
  const [sizeResult, setSizeResult] = useState("");
  const [sizeError, setSizeError] = useState("");

  const handleProjectSize = async () => {
    setSizeDialogOpen(true);
    setSizeResult("");
    setSizeError("");
    setSizeLoading(true);
    try {
      const data = await fetchProjectTasks(projectId);
      const tasks = data.items;
      const summary = tasks
        .map(
          (t) =>
            `- [${t.status}][${t.priority}] ${t.title}${t.description ? `: ${t.description.slice(0, 100)}` : ""}`,
        )
        .join("\n");

      const statusCounts = tasks.reduce(
        (acc, t) => {
          acc[t.status] = (acc[t.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const prompt = `You are analyzing a project called "${projectName || "Unknown"}". Here are its tasks (${tasks.length} total):

Status breakdown: ${Object.entries(statusCounts)
        .map(([s, c]) => `${s}: ${c}`)
        .join(", ")}

${summary}

Provide a concise project size assessment:
1. T-shirt size estimate (XS/S/M/L/XL) with justification
2. Estimated effort in developer-days
3. Complexity analysis (what makes it hard/easy)
4. Risk areas or blockers you spot
5. Suggested breakdown if it's too large

Be direct and practical. Output plain text, no markdown headers.`;

      const res = await claudeChat(prompt, projectId);
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let text = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Buffer across reads: the CLI (`claude -p`) emits its whole answer as
        // one large `data:` frame, which is routinely split across chunk
        // boundaries. Parsing per-chunk would JSON.parse a partial line, throw,
        // and silently drop the frame — leaving the dialog blank forever.
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const d = JSON.parse(line.slice(6));
              if (d.type === "delta" && d.text) {
                text += d.text;
                setSizeResult(text);
              } else if (d.type === "error") {
                setSizeError(d.message || "Analysis failed.");
              }
            } catch {}
          }
        }
      }
    } catch {
      setSizeError("Failed to analyze project. Make sure Claude AI is available.");
    } finally {
      setSizeLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap rounded-lg bg-card/50 border border-border/40 px-3 py-2">
        <MilestoneSelector projectId={projectId} />

        <Separator orientation="vertical" className="h-5 mx-1" />

        <TaskSortSelect value={sort} onChange={onSortChange} />

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks..."
            className="h-8 w-[200px] pl-8 text-xs bg-background/50"
          />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="list-view" className="text-xs text-muted-foreground">
              List
            </Label>
            <Switch
              id="list-view"
              checked={listView}
              onCheckedChange={onListViewChange}
              className="h-4 w-8"
            />
          </div>

          <Separator orientation="vertical" className="h-5 mx-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="outline" className="h-8 w-8">
                <Download className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={async () => {
                  const data = await fetchProjectTasks(projectId);
                  downloadFile(tasksToCSV(data.items), `tasks-${projectId}.csv`, "text/csv");
                }}
              >
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  const data = await fetchProjectTasks(projectId);
                  downloadFile(
                    tasksToJSON(data.items),
                    `tasks-${projectId}.json`,
                    "application/json",
                  );
                }}
              >
                Export JSON
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  const data = await fetchProjectTasks(projectId);
                  downloadFile(
                    tasksToMarkdown(data.items, projectName),
                    `tasks-${projectId}.md`,
                    "text/markdown",
                  );
                }}
              >
                Export Markdown
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={handleProjectSize}
            disabled={sizeLoading}
          >
            {sizeLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BarChart3 className="h-3.5 w-3.5" />
            )}
            Project Size
          </Button>

          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => setMilestoneManagerOpen(true)}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Button>

          {onBatchResolve && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={onBatchResolve}
              disabled={batchResolveRunning}
            >
              {batchResolveRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              Resolve All
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setChatOpen(true)}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setSupervisorOpen(true)}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Supervisor
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setSpecialistOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Specialist
          </Button>

          <Button size="sm" className="h-8 gap-1.5" onClick={onNewTask}>
            <Plus className="h-3.5 w-3.5" />
            New Task
          </Button>
        </div>
      </div>

      <Sheet open={chatOpen} onOpenChange={setChatOpen}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
          <SheetHeader className="px-3 py-2 border-b">
            <SheetTitle className="text-sm">Chat — project context</SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            <AIChatPanel projectId={projectId} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={supervisorOpen} onOpenChange={setSupervisorOpen}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
          <SheetHeader className="px-3 py-2 border-b">
            <SheetTitle className="text-sm">Supervisor</SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            <SupervisorPanel />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={specialistOpen} onOpenChange={setSpecialistOpen}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
          <SheetHeader className="px-3 py-2 border-b">
            <SheetTitle className="text-sm">Specialist</SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            <SpecialistChatPanel />
          </div>
        </SheetContent>
      </Sheet>

      <MilestoneManagerDialog
        open={milestoneManagerOpen}
        onOpenChange={setMilestoneManagerOpen}
        projectId={projectId}
      />

      <Dialog open={sizeDialogOpen} onOpenChange={setSizeDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Project Size — {projectName || "Project"}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            {sizeError ? (
              <div className="py-6 px-1 text-sm text-destructive whitespace-pre-wrap leading-relaxed">
                {sizeError}
              </div>
            ) : sizeResult ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{sizeResult}</p>
            ) : sizeLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Analyzing project...
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No assessment produced.
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
