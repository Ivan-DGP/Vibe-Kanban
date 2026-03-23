import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useCommit } from "@/hooks";

interface GitCommitFormProps {
  projectId: string;
  subPath?: string;
  hasStagedFiles: boolean;
}

export default function GitCommitForm({ projectId, subPath, hasStagedFiles }: GitCommitFormProps) {
  const [message, setMessage] = useState("");
  const commit = useCommit();

  const handleCommit = () => {
    if (!message.trim() || !hasStagedFiles) return;
    commit.mutate({ projectId, message: message.trim(), subPath }, {
      onSuccess: () => setMessage(""),
    });
  };

  return (
    <div className="space-y-2">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Commit message..."
        className="w-full min-h-[60px] rounded-md border bg-background px-2 py-1.5 text-xs resize-none"
        rows={2}
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key === "Enter") handleCommit();
        }}
      />
      <Button
        size="sm"
        className="w-full h-7 text-xs"
        onClick={handleCommit}
        disabled={!message.trim() || !hasStagedFiles || commit.isPending}
      >
        {commit.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
        Commit
      </Button>
    </div>
  );
}
