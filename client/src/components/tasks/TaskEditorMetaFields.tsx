import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import BranchSelector from "@/components/git/BranchSelector";
import type { TaskStatus, TaskPriority, PromptProfile } from "@vibe-kanban/shared";

interface TaskEditorMetaFieldsProps {
  projectId: string;
  priority: TaskPriority;
  onPriorityChange: (v: TaskPriority) => void;
  status: TaskStatus;
  onStatusChange: (v: TaskStatus) => void;
  milestoneId: string;
  onMilestoneChange: (v: string) => void;
  milestones: Array<{ id: string; name: string }> | undefined;
  branch: string | null;
  onBranchChange: (v: string | null) => void;
  promptProfile: PromptProfile;
  onPromptProfileChange: (v: PromptProfile) => void;
}

export default function TaskEditorMetaFields({
  projectId,
  priority,
  onPriorityChange,
  status,
  onStatusChange,
  milestoneId,
  onMilestoneChange,
  milestones,
  branch,
  onBranchChange,
  promptProfile,
  onPromptProfileChange,
}: TaskEditorMetaFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label>Priority</Label>
          <Select value={priority} onValueChange={(v) => onPriorityChange(v as TaskPriority)}>
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
          <Select value={status} onValueChange={(v) => onStatusChange(v as TaskStatus)}>
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
          <Select value={milestoneId} onValueChange={onMilestoneChange}>
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
          <BranchSelector projectId={projectId} value={branch} onSelect={onBranchChange} />
        </div>
        <div className="space-y-2">
          <Label>AI Profile</Label>
          <Select
            value={promptProfile}
            onValueChange={(v) => onPromptProfileChange(v as PromptProfile)}
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
    </>
  );
}
