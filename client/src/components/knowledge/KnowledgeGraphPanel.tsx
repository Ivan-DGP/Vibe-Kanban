import { useState } from "react";
import GraphTab from "./GraphTab";
import DependencyGraphView from "./DependencyGraphView";
import { useDepGraph, useRefreshDepGraph, useGraphFromDeps } from "@/hooks/useGraph";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, RefreshCw, Network, GitFork, AlertTriangle, Sparkles } from "lucide-react";

interface Props {
  projectId: string;
}

// Hosts the two graph views under the Knowledge → Graph tab: the editable
// knowledge graph (GraphTab, unchanged) and the read-only import/dependency
// graph derived from the project's source on demand.
export default function KnowledgeGraphPanel({ projectId }: Props) {
  const [mode, setMode] = useState<"knowledge" | "dependencies">("knowledge");
  const showDeps = mode === "dependencies";
  const { data: dep, isLoading, isError, error } = useDepGraph(projectId, showDeps);
  const refresh = useRefreshDepGraph(projectId);
  const fromDeps = useGraphFromDeps(projectId);

  const isolated = dep ? dep.nodes.filter((n) => n.degree === 0).length : 0;

  const draftFromDeps = () =>
    fromDeps.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(
          `Drafted ${r.nodes} subsystem${r.nodes === 1 ? "" : "s"} + ${r.edges} link${r.edges === 1 ? "" : "s"} as suggestions — review and confirm them.`,
        ),
      onError: () => toast.error("Couldn't draft the graph from dependencies."),
    });

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-md border border-border p-0.5">
          <ModeButton
            active={mode === "knowledge"}
            onClick={() => setMode("knowledge")}
            icon={<Network className="size-3.5" />}
          >
            Knowledge
          </ModeButton>
          <ModeButton
            active={showDeps}
            onClick={() => setMode("dependencies")}
            icon={<GitFork className="size-3.5" />}
          >
            Dependencies
          </ModeButton>
        </div>

        {showDeps && dep && (
          <>
            <span className="text-xs text-muted-foreground tabular-nums">
              {dep.fileCount} files · {dep.edges.length} imports · {dep.communityCount} subsystems
              {isolated > 0 && ` · ${isolated} isolated`}
            </span>
            {dep.cycles.length > 0 && (
              <span
                className="flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                title={dep.cycles
                  .map((c) => c.map((id) => id.split("/").pop()).join(" ↔ "))
                  .join("\n")}
              >
                <AlertTriangle className="size-3.5" />
                {dep.cycles.length} {dep.cycles.length === 1 ? "cycle" : "cycles"}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
            >
              {refresh.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Refresh
            </Button>
          </>
        )}

        {!showDeps && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={draftFromDeps}
            disabled={fromDeps.isPending}
            title="Create suggested subsystem nodes + links in the knowledge graph from the code's import structure"
          >
            {fromDeps.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Draft from dependencies
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {!showDeps ? (
          <GraphTab projectId={projectId} />
        ) : isLoading ? (
          <Centered>
            <Loader2 className="size-5 animate-spin" />
            Analyzing imports…
          </Centered>
        ) : isError ? (
          <Centered>
            <span className="text-destructive">
              {(error as Error)?.message || "Failed to build dependency graph"}
            </span>
            <Button size="sm" variant="outline" onClick={() => refresh.mutate()}>
              Try again
            </Button>
          </Centered>
        ) : dep && dep.nodes.length > 0 ? (
          <DependencyGraphView nodes={dep.nodes} edges={dep.edges} />
        ) : (
          <Centered>No source files found for this project.</Centered>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
