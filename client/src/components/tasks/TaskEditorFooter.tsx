import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface TaskEditorFooterProps {
  isEditing: boolean;
  isPending: boolean;
  title: string;
  onCancel: () => void;
  onSubmit: () => void;
}

export default function TaskEditorFooter({
  isEditing,
  isPending,
  title,
  onCancel,
  onSubmit,
}: TaskEditorFooterProps) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button onClick={onSubmit} disabled={isPending || !title.trim()}>
        {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
        {isEditing ? "Save" : "Create"}
      </Button>
    </DialogFooter>
  );
}
