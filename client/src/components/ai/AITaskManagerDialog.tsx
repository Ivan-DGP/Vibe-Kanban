import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Bot } from "lucide-react";
import { useCreateTerminalSession } from "@/hooks/useTerminal";
import { useAppStore } from "@/stores/appStore";

interface AITaskManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectPath: string;
}

export default function AITaskManagerDialog({ open, onOpenChange, projectId, projectPath }: AITaskManagerDialogProps) {
  const [instructions, setInstructions] = useState("");
  const createSession = useCreateTerminalSession();
  const { toggleTerminal, terminalVisible } = useAppStore();

  const handleSend = () => {
    if (!instructions.trim()) return;
    if (!terminalVisible) toggleTerminal();
    createSession.mutate({
      type: "claude-ai",
      projectId,
    });
    setInstructions("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            AI Task Manager
          </DialogTitle>
        </DialogHeader>

        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder='e.g., "Mark all auth tasks as done" or "Create 3 tasks for the login feature"'
          className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm"
          rows={4}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={!instructions.trim()}>
            <Bot className="h-4 w-4 mr-1" />
            Send to Claude
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
