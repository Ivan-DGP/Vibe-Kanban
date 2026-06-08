import { useState } from "react";
import { toast } from "sonner";
import { useNotionDatabasePages, useNotionPage, useImportNotionDatabase } from "@/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, ExternalLink, FileText, Loader2, Download } from "lucide-react";
import type { NotionPage } from "@vibe-kanban/shared";

interface NotionPanelProps {
  databaseId: string;
  projectId: string;
}

export default function NotionPanel({ databaseId, projectId }: NotionPanelProps) {
  const { data, isLoading, error } = useNotionDatabasePages(databaseId);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const importMutation = useImportNotionDatabase();

  const handleImport = () => {
    importMutation.mutate(projectId, {
      onSuccess: ({ imported, updated, total }) => {
        toast.success(
          `Imported ${imported} new, updated ${updated} of ${total} Notion page${total === 1 ? "" : "s"} as tasks`,
        );
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Notion import failed: ${msg}`);
      },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-[200px]" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load Notion database: {(error as Error).message}
      </div>
    );
  }

  if (selectedPageId) {
    return <NotionPageView pageId={selectedPageId} onBack={() => setSelectedPageId(null)} />;
  }

  const pages = data?.pages ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Notion Pages</span>
        <span className="text-xs text-muted-foreground">({pages.length})</span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-7 text-xs gap-1.5"
          onClick={handleImport}
          disabled={importMutation.isPending || pages.length === 0}
          title="Import all pages as tasks (upsert by Notion page id)"
        >
          {importMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          Import to Tasks
        </Button>
      </div>

      {pages.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          No pages found in this database. Make sure the integration has access.
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="divide-y divide-border/40">
            {pages.map((page) => (
              <PageRow key={page.id} page={page} onClick={() => setSelectedPageId(page.id)} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function PageRow({ page, onClick }: { page: NotionPage; onClick: () => void }) {
  const propEntries = Object.entries(page.properties).filter(
    ([key]) => key !== "Name" && key !== "title",
  );

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-2.5 hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm shrink-0">{page.icon || "📄"}</span>
        <span className="text-sm font-medium truncate">{page.title}</span>
        <a
          href={page.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto shrink-0 text-muted-foreground hover:text-primary"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      {propEntries.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {propEntries.slice(0, 4).map(([key, val]) => (
            <span key={key} className="text-[10px] text-muted-foreground">
              <span className="font-medium">{key}:</span>{" "}
              {Array.isArray(val) ? val.join(", ") : String(val ?? "—")}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function NotionPageView({ pageId, onBack }: { pageId: string; onBack: () => void }) {
  const { data, isLoading, error } = useNotionPage(pageId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        {isLoading ? (
          <Skeleton className="h-4 w-[160px]" />
        ) : (
          <>
            <span className="text-sm font-medium truncate">{data?.title}</span>
            {data?.url && (
              <a
                href={data.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto shrink-0 text-muted-foreground hover:text-primary"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading page content...
            </div>
          ) : error ? (
            <div className="text-sm text-destructive">
              Failed to load page: {(error as Error).message}
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap">
              {data?.markdown || "No content."}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
