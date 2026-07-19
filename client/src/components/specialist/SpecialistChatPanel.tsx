import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, Sparkles, User, BookOpen, Search } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { specialistChat } from "@/hooks/useSpecialist";
import type { SpecialistSource } from "@vibe-kanban/shared";

interface ToolStep {
  name: string;
  summary?: string;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: SpecialistSource[];
  /** Agentic engine: the MCP tool calls the model made, in order. */
  steps?: ToolStep[];
  /** "agentic" | "grounded" — which engine answered. */
  engine?: string;
}

/** The agent's MCP tool calls, shown as inline steps while it works. */
function Steps({ steps }: { steps: ToolStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="mb-2 space-y-1">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Search className="h-3 w-3 shrink-0" />
          <span className="font-mono">{s.name}</span>
          {s.summary && <span className="truncate opacity-70">{s.summary}</span>}
        </div>
      ))}
    </div>
  );
}

/** Compact citation list rendered above an assistant answer. */
function Sources({ sources }: { sources: SpecialistSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mb-2 rounded-md border border-border/60 bg-background/50 p-2">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <BookOpen className="h-3 w-3" />
        Grounded in {sources.length} source{sources.length === 1 ? "" : "s"}
      </div>
      <div className="flex flex-wrap gap-1">
        {sources.map((s) => (
          <Badge
            key={`${s.kind}-${s.id}`}
            variant="secondary"
            className="max-w-full text-[10px]"
            title={s.snippet ?? undefined}
          >
            <span className="text-muted-foreground">{s.kind}</span>
            <span className="mx-1 truncate">{s.label}</span>
            {s.project && <span className="text-muted-foreground">· {s.project}</span>}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * Cross-project Specialist chat: each turn is grounded server-side in knowledge +
 * memory across ALL projects, then streamed. The first SSE frame carries the cited
 * sources, which render above the answer.
 */
export default function SpecialistChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || streaming) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setStreaming(true);

    try {
      const response = await specialistChat(msg);
      const reader = response.body?.getReader();
      if (!reader) return;

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      let assistant = "";
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Buffer across reads: an SSE `data:` frame is routinely split across chunk
        // boundaries; parsing per-chunk would drop a frame on a partial-line parse.
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "engine") {
              const engine = data.mode as string;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], engine };
                return next;
              });
            } else if (data.type === "tool") {
              const step: ToolStep = { name: data.name, summary: data.summary };
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                next[next.length - 1] = { ...last, steps: [...(last.steps ?? []), step] };
                return next;
              });
            } else if (data.type === "sources") {
              const sources = data.sources as SpecialistSource[];
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], sources };
                return next;
              });
            } else if (data.type === "delta" && data.text) {
              assistant += data.text;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], content: assistant };
                return next;
              });
            } else if (data.type === "error") {
              assistant += `\n\n_Error: ${data.message || "request failed"}_`;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], content: assistant };
                return next;
              });
            }
          } catch {
            /* ignore partial/non-JSON frames */
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error: Failed to reach the Specialist." },
      ]);
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex h-full flex-col border-l">
      <div className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-medium">
        <Sparkles className="h-3.5 w-3.5" />
        Specialist — knows every project
      </div>

      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {messages.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Ask anything across all your projects — e.g. “Have we solved JWT rotation before, and
              what failed?”
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
              {m.role === "assistant" && (
                <Sparkles className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "prose prose-sm max-w-none bg-muted dark:prose-invert"
                }`}
              >
                {m.role === "assistant" ? (
                  <>
                    {m.steps && <Steps steps={m.steps} />}
                    {m.sources && <Sources sources={m.sources} />}
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </>
                ) : (
                  m.content
                )}
              </div>
              {m.role === "user" && (
                <User className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </div>
          ))}
          {streaming && messages[messages.length - 1]?.content === "" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Searching across projects…
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <div className="border-t p-2">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Ask the specialist…"
            className="text-sm"
            disabled={streaming}
          />
          <Button
            size="icon"
            aria-label="Send"
            onClick={handleSend}
            disabled={!input.trim() || streaming}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
