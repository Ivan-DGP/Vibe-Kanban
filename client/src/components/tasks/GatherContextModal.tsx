import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle2, XCircle, FileSearch, Copy, Check } from "lucide-react";
import { api } from "@/lib/api";

type Phase = "connecting" | "streaming" | "done" | "error";

interface GatherContextModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  taskDescription?: string;
  projectId: string;
  onAccept: (text: string) => void;
}

export default function GatherContextModal({
  open,
  onOpenChange,
  taskTitle,
  taskDescription,
  projectId,
  onAccept,
}: GatherContextModalProps) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [streamedText, setStreamedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const runGatherContext = useCallback(async () => {
    setPhase("connecting");
    setStreamedText("");
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 90_000);

    try {
      const res = await api.claude.gatherContext(
        taskTitle,
        projectId,
        taskDescription || undefined,
        controller.signal,
      );

      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      setPhase("streaming");
      const decoder = new TextDecoder();
      let buffer = "";
      let streamDone = false;

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
              if (d.type === "delta" && d.text) {
                setStreamedText((prev) => prev + d.text);
              }
              if (d.type === "done") {
                streamDone = true;
                break;
              }
              if (d.type === "error") {
                throw new Error(d.message || "AI error");
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }

      setPhase("done");
    } catch (e) {
      if (controller.signal.aborted) {
        setError("Request was cancelled");
      } else {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
      setPhase("error");
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
    }
  }, [taskTitle, taskDescription, projectId]);

  useEffect(() => {
    if (open) {
      runGatherContext();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [open, runGatherContext]);

  // Auto-scroll to bottom as text streams
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamedText]);

  const handleAccept = () => {
    onAccept(streamedText);
    onOpenChange(false);
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    onOpenChange(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(streamedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const phaseIcon = {
    connecting: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
    streaming: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
    done: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    error: <XCircle className="h-4 w-4 text-red-500" />,
  };

  const phaseLabel = {
    connecting: "Connecting to AI...",
    streaming: "Generating context...",
    done: "Context ready",
    error: error || "Failed",
  };

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="h-4 w-4" />
            Gather Context
          </DialogTitle>
          <DialogDescription className="sr-only">
            AI-generated implementation context for the task
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-sm px-1">
          {phaseIcon[phase]}
          <span className={phase === "error" ? "text-red-500" : "text-muted-foreground"}>
            {phaseLabel[phase]}
          </span>
          {phase === "streaming" && (
            <span className="text-xs text-muted-foreground ml-auto">
              {streamedText.length} chars
            </span>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-[300px] max-h-[50vh] border rounded-md">
          <div ref={scrollRef} className="p-3 text-sm font-mono whitespace-pre-wrap break-words">
            {streamedText || (
              <span className="text-muted-foreground italic">
                {phase === "connecting" ? "Analyzing project structure, dependencies, and git history..." : "No output yet"}
              </span>
            )}
            {phase === "streaming" && <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" />}
          </div>
        </ScrollArea>

        {phase === "error" && (
          <div className="text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {streamedText && (
            <Button variant="ghost" size="sm" onClick={handleCopy} className="mr-auto gap-1">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          <Button variant="outline" onClick={handleCancel}>
            {phase === "streaming" ? "Cancel" : "Discard"}
          </Button>
          <Button onClick={handleAccept} disabled={!streamedText || phase === "connecting"}>
            Use as Prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
