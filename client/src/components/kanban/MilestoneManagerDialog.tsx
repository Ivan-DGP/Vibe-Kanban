import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Check, X, Archive, ArchiveRestore } from "lucide-react";
import { useMilestones, useCreateMilestone, useUpdateMilestone, useDeleteMilestone } from "@/hooks";

interface MilestoneManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export default function MilestoneManagerDialog({ open, onOpenChange, projectId }: MilestoneManagerDialogProps) {
  const { data: milestones } = useMilestones(projectId);
  const createMilestone = useCreateMilestone(projectId);
  const updateMilestone = useUpdateMilestone();
  const deleteMilestone = useDeleteMilestone();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

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
    updateMilestone.mutate({ id: editingId, input: { name: editName.trim() } }, {
      onSuccess: () => setEditingId(null),
    });
  };

  const toggleStatus = (id: string, currentStatus: "active" | "closed") => {
    updateMilestone.mutate({ id, input: { status: currentStatus === "active" ? "closed" : "active" } });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this milestone? Tasks will be moved to General.")) return;
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
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>Add</Button>
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
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-sm flex-1">{m.name}</span>
                  <Badge variant={m.status === "active" ? "default" : "secondary"} className="text-[10px]">
                    {m.status}
                  </Badge>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(m.id, m.name)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleStatus(m.id, m.status)}>
                    {m.status === "active" ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(m.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
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
