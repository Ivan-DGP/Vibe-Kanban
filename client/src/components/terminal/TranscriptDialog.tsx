import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, ScrollText } from "lucide-react";
import { useTranscript } from "@/hooks/useTerminal";

interface TranscriptDialogProps {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Strip ANSI escape / control sequences so the log reads as plain text. Built
// from ASCII-only strings (hex escapes) so no raw control bytes live in source.
// Pattern per the `ansi-regex` package: matches OSC (…BEL) and CSI/SGR runs.
/* eslint-disable no-control-regex */
const ANSI_RE = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:;[-a-zA-Z\\d/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~])",
  "g",
);
// Remaining lone C0 control chars, keeping tab (09), newline (0A), return (0D).
const CTRL_RE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g");
/* eslint-enable no-control-regex */

function clean(raw: string): string {
  return raw
    .replace(ANSI_RE, "")
    .replace(CTRL_RE, "")
    .replace(/\r(?!\n)/g, "\n");
}

export default function TranscriptDialog({ sessionId, open, onOpenChange }: TranscriptDialogProps) {
  const { data, isLoading, isError } = useTranscript(sessionId, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-4 w-4" />
            Session output
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px] truncate">
            {sessionId}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading transcript…
          </div>
        ) : isError || !data ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No transcript available for this session.
          </div>
        ) : (
          <ScrollArea className="h-[60vh] rounded-md border bg-[#1a1a2e]">
            <pre className="p-3 text-xs leading-relaxed text-[#e0e0e0] whitespace-pre-wrap break-words font-mono">
              {clean(data.content) || "(empty)"}
            </pre>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
