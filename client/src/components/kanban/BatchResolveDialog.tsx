import type { Dispatch, SetStateAction } from "react";
import { Minus, Plus, GitBranch } from "lucide-react";
import type { AiAgent } from "@vibe-kanban/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import BranchSelector from "@/components/git/BranchSelector";

interface BatchResolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  taskCount: number;
  concurrency: number;
  onConcurrencyChange: Dispatch<SetStateAction<number>>;
  branchGroups: Map<string, number>;
  overrideBranch: string | null;
  onOverrideBranchChange: (branch: string | null) => void;
  agent: AiAgent;
  onAgentChange: (agent: AiAgent) => void;
  onConfirm: () => void;
}

export default function BatchResolveDialog({
  open,
  onOpenChange,
  projectId,
  taskCount,
  concurrency,
  onConcurrencyChange,
  branchGroups,
  overrideBranch,
  onOverrideBranchChange,
  agent,
  onAgentChange,
  onConfirm,
}: BatchResolveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Batch AI Resolve</DialogTitle>
          <DialogDescription>
            Start AI Resolve for {taskCount} task{taskCount !== 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between py-2">
          <label className="text-sm font-medium">Agent</label>
          <Select value={agent} onValueChange={(v) => onAgentChange(v as AiAgent)}>
            <SelectTrigger className="w-[140px] h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude">Claude</SelectItem>
              <SelectItem value="opencode">OpenCode</SelectItem>
              <SelectItem value="grok">Grok</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between py-2">
          <label className="text-sm font-medium">Concurrency</label>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={() => onConcurrencyChange((c) => Math.max(1, c - 1))}
              disabled={concurrency <= 1}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-8 text-center text-sm font-mono">{concurrency}</span>
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={() => onConcurrencyChange((c) => Math.min(10, c + 1))}
              disabled={concurrency >= 10}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {concurrency === 1
            ? "Tasks will be processed one at a time."
            : `Up to ${concurrency} tasks will be processed in parallel.`}
        </p>

        {/* Branch groups summary */}
        {branchGroups.size > 1 && !overrideBranch && (
          <div className="space-y-1.5 py-1">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5" />
              Branch Groups
            </label>
            {Array.from(branchGroups).map(([branch, count]) => (
              <div key={branch} className="flex items-center justify-between text-xs px-1">
                <span className="font-mono truncate">{branch}</span>
                <span className="text-muted-foreground">
                  {count} task{count !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Tasks processed branch-by-branch. Only same-branch tasks run concurrently.
            </p>
          </div>
        )}

        {/* Override branch for all */}
        <div className="space-y-1.5 py-1">
          <label className="text-sm font-medium">Override branch (optional)</label>
          <BranchSelector
            projectId={projectId}
            value={overrideBranch}
            onSelect={onOverrideBranchChange}
          />
          <p className="text-[11px] text-muted-foreground">
            Run all tasks on a specific branch instead of their assigned branches.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Start</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
