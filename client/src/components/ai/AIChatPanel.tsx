import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, Bot, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";
import type { ChatMessage } from "@vibe-kanban/shared";

interface AIChatPanelProps {
  projectId?: string;
}

export default function AIChatPanel({ projectId }: AIChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
      const response = await api.claude.chat(msg, projectId);
      const reader = response.body?.getReader();
      if (!reader) return;

      let assistantContent = "";
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "delta" && data.text) {
                assistantContent += data.text;
                setMessages((prev) => [
                  ...prev.slice(0, -1),
                  { role: "assistant", content: assistantContent },
                ]);
              }
            } catch {}
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error: Failed to get response from Claude." },
      ]);
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex flex-col h-full border-l">
      <div className="px-3 py-2 border-b text-xs font-medium flex items-center gap-1.5">
        <Bot className="h-3.5 w-3.5" />
        Claude AI
      </div>

      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
              {msg.role === "assistant" && <Bot className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />}
              <div className={`text-sm max-w-[85%] rounded-lg px-3 py-2 ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted prose prose-sm dark:prose-invert max-w-none"
              }`}>
                {msg.role === "assistant" ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
              {msg.role === "user" && <User className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />}
            </div>
          ))}
          {streaming && messages[messages.length - 1]?.content === "" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Thinking...
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <div className="p-2 border-t">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Ask Claude..."
            className="text-sm"
            disabled={streaming}
          />
          <Button size="icon" onClick={handleSend} disabled={!input.trim() || streaming}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
