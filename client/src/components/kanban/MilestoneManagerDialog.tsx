import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Check, X, Archive, ArchiveRestore, Bot } from "lucide-react";
import { useMilestones, useCreateMilestone, useUpdateMilestone, useDeleteMilestone } from "@/hooks";
import { useConfirm } from "@/hooks/useConfirm";

interface MilestoneManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export default function MilestoneManagerDialog({
  open,
  onOpenChange,
  projectId,
}: MilestoneManagerDialogProps) {
  const { data: milestones } = useMilestones(projectId);
  const createMilestone = useCreateMilestone(projectId);
  const updateMilestone = useUpdateMilestone();
  const deleteMilestone = useDeleteMilestone();
  const confirm = useConfirm();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [instructionsId, setInstructionsId] = useState<string | null>(null);
  const [instructionsText, setInstructionsText] = useState("");

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMilestone.mutate({ name: newName.trim() }, { onSuccess: () => setNewName("") });
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return;
    updateMilestone.mutate(
      { id: editingId, input: { name: editName.trim() } },
      {
        onSuccess: () => setEditingId(null),
      },
    );
  };

  const toggleStatus = (id: string, currentStatus: "active" | "closed") => {
    updateMilestone.mutate({
      id,
      input: { status: currentStatus === "active" ? "closed" : "active" },
    });
  };

  const toggleInstructions = (id: string, current: string | null) => {
    if (instructionsId === id) {
      setInstructionsId(null);
    } else {
      setInstructionsId(id);
      setInstructionsText(current ?? "");
    }
  };

  const saveInstructions = (id: string) => {
    updateMilestone.mutate(
      { id, input: { aiInstructions: instructionsText.trim() || null } },
      {
        onSuccess: () => setInstructionsId(null),
      },
    );
  };

  const handleDelete = async (id: string) => {
    if (
      !(await confirm({
        title: "Delete Milestone",
        description: "Delete this milestone? Tasks will be moved to General.",
      }))
    )
      return;
    deleteMilestone.mutate(id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Milestones</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="New milestone name..."
            className="h-8 text-sm"
          />
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
            Add
          </Button>
        </div>

        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {milestones?.map((m) => (
            <div key={m.id} className="flex items-center gap-2 p-2 rounded border">
              {editingId === m.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                    className="h-7 text-sm flex-1"
                    autoFocus
                  />
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveEdit}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setEditingId(null)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-sm flex-1">{m.name}</span>
                  <Badge
                    variant={m.status === "active" ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {m.status}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => startEdit(m.id, m.name)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => toggleStatus(m.id, m.status)}
                  >
                    {m.status === "active" ? (
                      <Archive className="h-3.5 w-3.5" />
                    ) : (
                      <ArchiveRestore className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`h-7 w-7 ${m.aiInstructions ? "text-blue-500" : ""}`}
                    onClick={() => toggleInstructions(m.id, m.aiInstructions)}
                    title="AI Instructions"
                  >
                    <Bot className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => handleDelete(m.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
              {instructionsId === m.id && (
                <div className="w-full mt-2 space-y-1.5">
                  <textarea
                    value={instructionsText}
                    onChange={(e) => setInstructionsText(e.target.value)}
                    placeholder="AI instructions for this milestone...&#10;e.g., always run bun test:api, focus on API layer"
                    className="w-full min-h-[60px] rounded-md border bg-background px-2 py-1.5 text-xs resize-y"
                    rows={2}
                  />
                  <div className="flex gap-1 justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => setInstructionsId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => saveInstructions(m.id)}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {(!milestones || milestones.length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-4">No milestones yet</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
