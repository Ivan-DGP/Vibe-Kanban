import { useState } from "react";
import { useKnowledgeSearch, useKnowledgeStats, useKnowledgeBackfill } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Sparkles, RefreshCw, FileText, ListChecks, Network } from "lucide-react";
import type {
  KnowledgeSearchHit,
  KnowledgeArtifactHit,
  KnowledgeTaskHit,
  KnowledgeGraphNodeHit,
} from "@vibe-kanban/shared";

interface SearchTabProps {
  projectId: string;
}

type FilterMode = "all" | "artifact" | "task" | "graph_node";

export default function SearchTab({ projectId }: SearchTabProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const search = useKnowledgeSearch(projectId);
  const stats = useKnowledgeStats(projectId);
  const backfill = useKnowledgeBackfill(projectId);

  const onSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    const types =
      filter === "all" ? undefined : ([filter] as ("artifact" | "task" | "graph_node")[]);
    search.mutate({ query: q, k: 10, types });
  };

  const results = search.data?.results ?? [];
  const s = stats.data;
  const totalPending = (s?.pending ?? 0) + (s?.pendingTasks ?? 0) + (s?.pendingGraphNodes ?? 0);
  // Only disable while a backfill request is actually in flight. Using
  // `totalPending > 0` here deadlocks: any item that never auto-embeds keeps
  // the button locked forever, so the one control that would drain it is
  // unreachable exactly when it's needed.
  const indexing = backfill.isPending;
  const canIndex = totalPending > 0 && !indexing;

  const filterLabels: Record<FilterMode, string> = {
    all: "All",
    artifact: "Artifacts",
    task: "Tasks",
    graph_node: "Graph",
  };

  return (
    <div className="space-y-4 p-1">
      <form onSubmit={onSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artifacts, tasks, and graph nodes semantically…"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={search.isPending || !query.trim()}>
          {search.isPending ? "Searching…" : "Search"}
        </Button>
      </form>

      <div className="flex items-center gap-1">
        {(["all", "artifact", "task", "graph_node"] as FilterMode[]).map((m) => (
          <Button
            key={m}
            variant={filter === m ? "default" : "ghost"}
            size="sm"
            onClick={() => setFilter(m)}
            className="h-7 text-xs"
          >
            {filterLabels[m]}
          </Button>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-3.5 w-3.5" />
          {s ? (
            <>
              <span>
                {s.embeddedArtifacts}/{s.artifactCount} artifacts · {s.chunkCount} chunks
              </span>
              <span>
                · {s.embeddedTasks}/{s.taskCount} tasks · {s.taskChunkCount} chunks
              </span>
              <span>
                · {s.embeddedGraphNodes}/{s.graphNodeCount} nodes · {s.graphNodeChunkCount} chunks
              </span>
              {totalPending > 0 && <span className="text-amber-500">· {totalPending} pending</span>}
            </>
          ) : (
            <span>Loading stats…</span>
          )}
          <span className="ml-2 opacity-60">model: {s?.model ?? "—"}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => backfill.mutate(false)}
          disabled={!canIndex}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${indexing ? "animate-spin" : ""}`} />
          {indexing ? "Indexing…" : "Index missing"}
        </Button>
      </div>

      {search.isError && (
        <div className="text-sm text-red-500">
          Search failed: {(search.error as Error)?.message}
        </div>
      )}

      {search.data && results.length === 0 && (
        <div className="text-sm text-muted-foreground p-4 text-center">
          No results.{" "}
          {(s?.embeddedArtifacts ?? 0) === 0 &&
            (s?.embeddedTasks ?? 0) === 0 &&
            (s?.embeddedGraphNodes ?? 0) === 0 &&
            "Try indexing first."}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((hit) => (
            <ResultCard key={hit.id} hit={hit} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({ hit }: { hit: KnowledgeSearchHit }) {
  if (hit.kind === "artifact") return <ArtifactCard hit={hit} />;
  if (hit.kind === "task") return <TaskCard hit={hit} />;
  return <GraphNodeCard hit={hit} />;
}

function ArtifactCard({ hit }: { hit: KnowledgeArtifactHit }) {
  const scorePct = (hit.score * 100).toFixed(1);
  return (
    <Card className="p-3 space-y-2 hover:border-primary/40 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{hit.artifact.filename}</span>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {hit.artifact.type}
          </Badge>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            artifact
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{scorePct}%</span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">
        {hit.content}
      </p>
      <div className="text-[10px] text-muted-foreground/70">chunk #{hit.chunkIdx}</div>
    </Card>
  );
}

function TaskCard({ hit }: { hit: KnowledgeTaskHit }) {
  const scorePct = (hit.score * 100).toFixed(1);
  return (
    <Card className="p-3 space-y-2 hover:border-primary/40 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ListChecks className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">
            #{hit.task.taskNumber} · {hit.task.title}
          </span>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {hit.task.status}
          </Badge>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            task
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{scorePct}%</span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">
        {hit.content}
      </p>
      <div className="text-[10px] text-muted-foreground/70">chunk #{hit.chunkIdx}</div>
    </Card>
  );
}

function GraphNodeCard({ hit }: { hit: KnowledgeGraphNodeHit }) {
  const scorePct = (hit.score * 100).toFixed(1);
  return (
    <Card className="p-3 space-y-2 hover:border-primary/40 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Network className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{hit.graphNode.label}</span>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {hit.graphNode.type}
          </Badge>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            graph node
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{scorePct}%</span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">
        {hit.content}
      </p>
      <div className="text-[10px] text-muted-foreground/70">chunk #{hit.chunkIdx}</div>
    </Card>
  );
}
