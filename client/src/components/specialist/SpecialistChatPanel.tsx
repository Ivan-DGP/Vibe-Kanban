import { useState, useRef, useEffect } from "react";
import { useMatch } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Loader2,
  Sparkles,
  User,
  BookOpen,
  Search,
  Square,
  Trash2,
  Copy,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { specialistChat } from "@/hooks/useSpecialist";
import { useSpecialistStore, type ToolStep } from "@/stores/specialistStore";
import type { SpecialistSource } from "@vibe-kanban/shared";

/** The agent's MCP tool calls, shown as inline steps while it works. */
function Steps({ steps }: { steps: ToolStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="mb-2 space-y-1">
      {steps.map((s, i) => (
        <div key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Search className="mt-0.5 h-3 w-3 shrink-0" />
          {/* Wrap (don't nowrap/truncate): inside Radix ScrollArea a nowrap child
              blows out the width. The summary is already capped server-side. Strip the
              `mcp__<server>__` prefix so the tool name stays short. */}
          <span className="min-w-0 break-words leading-snug">
            <span className="font-mono">{s.name.replace(/^mcp__[a-z0-9-]+__/i, "")}</span>
            {s.summary && <span className="opacity-70"> — {s.summary}</span>}
          </span>
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
            className="flex max-w-full items-center gap-1 text-[10px]"
            title={s.snippet ? `${s.label}\n\n${s.snippet}` : s.label}
          >
            <span className="shrink-0 text-muted-foreground">{s.kind}</span>
            <span className="min-w-0 truncate">{s.label}</span>
            {s.project && <span className="shrink-0 text-muted-foreground">· {s.project}</span>}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/** Copy-to-clipboard button for an assistant answer. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      aria-label="Copy answer"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/70 transition-colors hover:text-foreground"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Cross-project Specialist chat: each turn is grounded server-side in knowledge +
 * memory (active project first when on a project page), then streamed. The first SSE
 * frame carries the cited sources, which render above the answer. Conversation state
 * lives in a store so it survives the panel being closed/reopened.
 */
export default function SpecialistChatPanel() {
  const { messages, setMessages, clear } = useSpecialistStore();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Active project (when viewing a project page) — floats its sources first.
  const projectMatch = useMatch("/project/:projectId");
  const activeProjectId = projectMatch?.params.projectId;

  // Auto-scroll to the newest content. Use instant scroll while streaming (a
  // smooth animation per token fights itself); smooth only when a turn settles.
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [messages, streaming]);

  // Abort any in-flight stream if the panel unmounts (Sheet close).
  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = () => abortRef.current?.abort();

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || streaming) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await specialistChat(msg, activeProjectId, controller.signal);
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
    } catch (err) {
      // A user-initiated abort (Stop / panel close) is not an error.
      if ((err as Error)?.name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Error: Failed to reach the Specialist." },
        ]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-medium">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 truncate">Specialist — knows every project</span>
        <button
          type="button"
          aria-label="Clear conversation"
          title="Clear conversation"
          onClick={clear}
          disabled={messages.length === 0 || streaming}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Force the Radix viewport's inner wrapper from `display:table` (min-width:100%)
          to block: otherwise wide children (code blocks, long URLs, tables) grow the
          table and make `max-w-[85%]` resolve against content width, overflowing the
          panel horizontally instead of wrapping/scrolling within it. */}
      <ScrollArea className="min-h-0 flex-1 p-3 [&_[data-radix-scroll-area-viewport]>div]:!block">
        <div className="space-y-3" aria-live="polite">
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
                className={`min-w-0 max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {m.role === "assistant" ? (
                  <>
                    {m.steps && <Steps steps={m.steps} />}
                    {m.sources && <Sources sources={m.sources} />}
                    {/* prose renders markdown; max-w-none fills the bubble, min-w-0 +
                        break-words + scrollable <pre> keep long content from
                        overflowing the panel horizontally. */}
                    <div className="prose prose-sm min-w-0 max-w-none break-words dark:prose-invert [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                    {m.engine && (
                      <span className="mt-1 inline-block text-[10px] uppercase tracking-wide text-muted-foreground/60">
                        {m.engine}
                      </span>
                    )}
                    {!streaming && <CopyButton text={m.content} />}
                  </>
                ) : (
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                )}
              </div>
              {m.role === "user" && <User className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
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
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Ask the specialist…"
            className="text-sm"
            disabled={streaming}
          />
          {streaming ? (
            <Button size="icon" variant="secondary" aria-label="Stop" onClick={stop}>
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" aria-label="Send" onClick={handleSend} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
