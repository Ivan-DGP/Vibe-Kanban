import { useState } from "react";
import { useKnowledgeSearch, useKnowledgeStats, useKnowledgeBackfill } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Sparkles, RefreshCw, FileText } from "lucide-react";
import type { KnowledgeSearchHit } from "@vibe-kanban/shared";

interface SearchTabProps {
  projectId: string;
}

export default function SearchTab({ projectId }: SearchTabProps) {
  const [query, setQuery] = useState("");
  const search = useKnowledgeSearch(projectId);
  const stats = useKnowledgeStats(projectId);
  const backfill = useKnowledgeBackfill(projectId);

  const onSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    search.mutate({ query: q, k: 10 });
  };

  const results = search.data?.results ?? [];
  const s = stats.data;
  const indexing = (s?.pending ?? 0) > 0 || backfill.isPending;

  return (
    <div className="space-y-4 p-1">
      <form onSubmit={onSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artifact content semantically…"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={search.isPending || !query.trim()}>
          {search.isPending ? "Searching…" : "Search"}
        </Button>
      </form>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" />
          {s ? (
            <span>
              {s.embeddedArtifacts}/{s.artifactCount} artifacts indexed · {s.chunkCount} chunks
              {s.pending > 0 && <span className="text-amber-500"> · {s.pending} pending</span>}
            </span>
          ) : (
            <span>Loading stats…</span>
          )}
          <span className="ml-2 opacity-60">model: {s?.model ?? "—"}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => backfill.mutate(false)}
          disabled={indexing}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${indexing ? "animate-spin" : ""}`} />
          {indexing ? "Indexing…" : "Index missing"}
        </Button>
      </div>

      {search.isError && (
        <div className="text-sm text-red-500">Search failed: {(search.error as Error)?.message}</div>
      )}

      {search.data && results.length === 0 && (
        <div className="text-sm text-muted-foreground p-4 text-center">
          No results. {(s?.embeddedArtifacts ?? 0) === 0 && "Try indexing artifacts first."}
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
  const scorePct = (hit.score * 100).toFixed(1);
  return (
    <Card className="p-3 space-y-2 hover:border-primary/40 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{hit.artifact.filename}</span>
          <Badge variant="outline" className="shrink-0 text-[10px]">{hit.artifact.type}</Badge>
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
