import { useState } from "react";
import { useMemory, useAppendMemory } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Plus, User, Bot } from "lucide-react";
import type { MemoryType, ProjectMemoryEvent } from "@vibe-kanban/shared";

interface MemoryPanelProps {
  projectId: string;
}

const TYPES: MemoryType[] = ["decision", "gotcha", "attempt_failed", "convention", "fragile_file"];
const TYPE_LABEL: Record<MemoryType, string> = {
  decision: "Decision",
  gotcha: "Gotcha",
  attempt_failed: "Failed attempt",
  convention: "Convention",
  fragile_file: "Fragile file",
};
// Tailwind color hints per type (kept subtle; badges use outline variant).
const TYPE_CLASS: Record<MemoryType, string> = {
  decision: "text-sky-500 border-sky-500/40",
  gotcha: "text-amber-500 border-amber-500/40",
  attempt_failed: "text-red-500 border-red-500/40",
  convention: "text-violet-500 border-violet-500/40",
  fragile_file: "text-orange-500 border-orange-500/40",
};

type FilterMode = "all" | MemoryType;

export default function MemoryPanel({ projectId }: MemoryPanelProps) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [adding, setAdding] = useState(false);

  const { data, isLoading } = useMemory(projectId, {
    type: filter === "all" ? undefined : filter,
    includeSuperseded: showSuperseded,
  });
  const events = data?.events ?? [];

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Brain className="h-4 w-4" />
          <span>
            Lessons from past runs — decisions, gotchas, and approaches that already failed.
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {adding && <AddMemoryForm projectId={projectId} onDone={() => setAdding(false)} />}

      <div className="flex items-center gap-1 flex-wrap">
        {(["all", ...TYPES] as FilterMode[]).map((m) => (
          <Button
            key={m}
            variant={filter === m ? "default" : "ghost"}
            size="sm"
            onClick={() => setFilter(m)}
            className="h-7 text-xs"
          >
            {m === "all" ? "All" : TYPE_LABEL[m]}
          </Button>
        ))}
        <Button
          variant={showSuperseded ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setShowSuperseded((v) => !v)}
          className="h-7 text-xs ml-2"
        >
          {showSuperseded ? "Hiding nothing" : "Show superseded"}
        </Button>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground p-4 text-center">Loading…</div>}

      {!isLoading && events.length === 0 && (
        <div className="text-sm text-muted-foreground p-4 text-center">
          No memory yet. Events are captured automatically from AI runs (deviations and failed
          attempts), or add one manually.
        </div>
      )}

      <div className="space-y-2">
        {events.map((e) => (
          <MemoryCard key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}

function MemoryCard({ event }: { event: ProjectMemoryEvent }) {
  const superseded = event.supersededBy !== null;
  return (
    <Card
      className={`p-3 space-y-2 transition-colors ${superseded ? "opacity-50" : "hover:border-primary/40"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className={`shrink-0 text-[10px] ${TYPE_CLASS[event.type]}`}>
            {TYPE_LABEL[event.type]}
          </Badge>
          <span
            className={`text-sm font-medium truncate ${superseded ? "line-through" : ""}`}
            title={event.title}
          >
            {event.title}
          </span>
        </div>
        <Badge variant="secondary" className="shrink-0 text-[10px] gap-1">
          {event.origin === "human" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
          {event.origin === "human" ? "human" : "AI"}
        </Badge>
      </div>

      {event.body && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">
          {event.body}
        </p>
      )}

      {event.files.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {event.files.map((f) => (
            <Badge key={f} variant="outline" className="text-[10px] font-mono">
              {f}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
        <span>{new Date(event.createdAt).toLocaleString()}</span>
        {event.taskId && <span>· task {event.taskId.slice(0, 8)}</span>}
        {event.runId && <span>· run {event.runId.slice(0, 8)}</span>}
        {superseded && <span className="text-amber-500">· superseded</span>}
      </div>
    </Card>
  );
}

function AddMemoryForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [type, setType] = useState<MemoryType>("decision");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const append = useAppendMemory(projectId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    append.mutate(
      { type, title: t, body: body.trim() || undefined },
      {
        onSuccess: () => {
          setTitle("");
          setBody("");
          onDone();
        },
      },
    );
  };

  return (
    <Card className="p-3 space-y-2">
      <form onSubmit={submit} className="space-y-2">
        <div className="flex items-center gap-1 flex-wrap">
          {TYPES.map((m) => (
            <Button
              key={m}
              type="button"
              variant={type === m ? "default" : "ghost"}
              size="sm"
              onClick={() => setType(m)}
              className="h-7 text-xs"
            >
              {TYPE_LABEL[m]}
            </Button>
          ))}
        </div>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short, searchable title…"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Detail / rationale (optional)…"
          className="w-full min-h-[64px] rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!title.trim() || append.isPending}>
            {append.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        {append.isError && (
          <div className="text-xs text-red-500">Failed: {(append.error as Error)?.message}</div>
        )}
      </form>
    </Card>
  );
}
