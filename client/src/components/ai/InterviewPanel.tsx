import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Bot, User, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { InterviewQa } from "@vibe-kanban/shared";

type InterviewMessage = { type: "question"; text: string } | { type: "complete"; summary?: string };

// The interviewer is prompted to emit bare JSON, but models often wrap it in
// prose or a ```json fence. Try a direct parse, then the first {...} block.
function extractJson(raw: string): InterviewMessage | null {
  const text = raw.trim();
  if (!text) return null;
  const tryParse = (s: string): InterviewMessage | null => {
    try {
      return JSON.parse(s) as InterviewMessage;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text);
  if (direct) return direct;
  const match = text.match(/\{[\s\S]*\}/);
  return match ? tryParse(match[0]) : null;
}

interface InterviewPanelProps {
  projectId: string;
  taskId: string;
  taskTitle: string;
  onClose: () => void;
  onFinalized?: () => void;
}

export default function InterviewPanel({
  projectId,
  taskId,
  taskTitle,
  onClose,
  onFinalized,
}: InterviewPanelProps) {
  const [qaList, setQaList] = useState<InterviewQa[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [phase, setPhase] = useState<"loading" | "question" | "complete" | "finalizing">("loading");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentQuestion, qaList, phase]);

  useEffect(() => {
    fetchNextQuestion([]);
  }, []);

  const fetchNextQuestion = async (answers: InterviewQa[]) => {
    setStreaming(true);
    setCurrentAnswer("");

    try {
      const response = await api.claude.interview.next(projectId, taskId, answers);
      // Non-2xx responses come back as plain JSON, not an SSE stream.
      if (!response.ok) {
        let msg = `Interview request failed (${response.status})`;
        try {
          const body = await response.json();
          if (body?.error) msg = body.error;
        } catch {}
        throw new Error(msg);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Interview stream had no body");

      let buffer = "";
      let lineBuf = "";
      const decoder = new TextDecoder();
      const consumeLine = (line: string) => {
        if (!line.startsWith("data: ")) return;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "delta" && data.text) buffer += data.text;
        } catch {}
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Accumulate across chunk boundaries; a data: frame may span reads.
        lineBuf += decoder.decode(value, { stream: true });
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
      }
      if (lineBuf) consumeLine(lineBuf);

      const parsed = extractJson(buffer);
      if (parsed?.type === "complete") {
        setCurrentQuestion(parsed.summary || "Interview complete.");
        setPhase("complete");
      } else if (parsed?.type === "question" && parsed.text) {
        setCurrentQuestion(parsed.text);
        setPhase("question");
      } else {
        // Model returned something unstructured — show it as the question
        // rather than hanging, but only if there's actually text.
        const raw = buffer.trim();
        if (!raw) throw new Error("Empty response from interviewer");
        setCurrentQuestion(raw);
        setPhase("question");
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to get next question");
      // Return to an answerable state instead of stranding phase on 'loading'.
      setPhase(qaList.length > 0 ? "complete" : "question");
    } finally {
      setStreaming(false);
    }
  };

  const handleSend = async () => {
    const answer = currentAnswer.trim();
    if (!answer || streaming) return;

    const updated = [...qaList, { question: currentQuestion, answer }];
    setQaList(updated);
    setPhase("loading");
    await fetchNextQuestion(updated);
  };

  const handleFinalize = async () => {
    setPhase("finalizing");
    try {
      const result = await api.claude.interview.finalize(projectId, taskId, qaList);
      if (result.ok) {
        toast.success("Interview saved as spec artifact");
        onFinalized?.();
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to finalize interview");
    }
  };

  return (
    <div className="flex flex-col h-full border-l">
      <div className="px-3 py-2 border-b text-xs font-medium flex items-center gap-1.5">
        <Bot className="h-3.5 w-3.5" />
        Interview: {taskTitle}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-muted-foreground hover:text-foreground"
          aria-label="Close interview"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {qaList.map((qa, i) => (
            <div key={i} className="space-y-2">
              <div className="flex gap-2">
                <Bot className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
                <div className="text-sm max-w-[85%] rounded-lg px-3 py-2 bg-muted">
                  {qa.question}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <div className="text-sm max-w-[85%] rounded-lg px-3 py-2 bg-primary text-primary-foreground">
                  {qa.answer}
                </div>
                <User className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
              </div>
            </div>
          ))}

          {phase === "loading" && streaming && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Preparing next question...
            </div>
          )}

          {phase === "question" && !streaming && (
            <div className="flex gap-2">
              <Bot className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
              <div className="text-sm max-w-[85%] rounded-lg px-3 py-2 bg-muted">
                {currentQuestion}
              </div>
            </div>
          )}

          {phase === "complete" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Bot className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
                <div className="text-sm max-w-[85%] rounded-lg px-3 py-2 bg-muted">
                  {currentQuestion}
                </div>
              </div>
              <div className="text-xs text-muted-foreground text-center">
                Interview complete. {qaList.length} question{qaList.length !== 1 ? "s" : ""}{" "}
                answered.
              </div>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {phase === "question" && (
        <div className="p-2 border-t">
          <div className="flex flex-col gap-2">
            <Textarea
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
              placeholder="Type your answer..."
              className="text-sm min-h-[60px]"
              disabled={streaming}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <div className="flex gap-2 self-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNextQuestion(qaList)}
                disabled={streaming}
              >
                Skip
              </Button>
              <Button size="sm" onClick={handleSend} disabled={!currentAnswer.trim() || streaming}>
                <Check className="h-3.5 w-3.5 mr-1" />
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase === "complete" && (
        <div className="p-2 border-t">
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onClose}>
              <X className="h-3.5 w-3.5 mr-1" />
              Discard
            </Button>
            <Button size="sm" onClick={handleFinalize} disabled={phase === "finalizing"}>
              {phase === "finalizing" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 mr-1" />
              )}
              Save Interview
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
