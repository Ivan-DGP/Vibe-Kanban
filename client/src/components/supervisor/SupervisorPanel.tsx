import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, Play, ShieldCheck, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useProjects } from "@/hooks/useProjects";
import { useSupervisorProposals, useScan, useDispatchProposal } from "@/hooks/useSupervisor";
import type { SupervisorProposal } from "@vibe-kanban/shared";

// Friendly labels for the signal kinds a proposal's metadata can carry.
const SIGNAL_LABEL: Record<string, string> = {
  roadmap: "Roadmap",
  finding: "Finding",
  stalled: "Stalled",
  unresolved: "Unresolved",
};

interface ProposalMeta {
  signalType?: string;
  score?: number;
  dispatchedRunId?: string;
}

/** The error thrown by the API client carries the HTTP status + parsed body. */
function dispatchErrorMessage(err: unknown): string {
  const e = err as { status?: number; body?: { error?: string } };
  const reason = e?.body?.error;
  if (e?.status === 403 || reason === "disabled") {
    return "Dispatch is disabled — set VK_SUPERVISOR_DISPATCH_ENABLED to enable it.";
  }
  return reason ? `Dispatch failed: ${reason}` : "Dispatch failed.";
}

/**
 * Cross-project supervisor review panel: lists the proposals the supervisor has
 * opened, lets the human trigger a fresh scan, and dispatch an individual
 * proposal into the isolated headless runner (human-approval gated on the server).
 */
export default function SupervisorPanel() {
  const { data, isLoading } = useSupervisorProposals();
  const scan = useScan();
  const dispatch = useDispatchProposal();
  const { data: projects } = useProjects();

  const proposals = data?.proposals ?? [];
  const projectName = (id: string) => projects?.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  const runScan = () =>
    scan.mutate(undefined, {
      onSuccess: (r) => toast.success(`Scan complete — ${r.created} new, ${r.skipped} existing`),
      onError: () => toast.error("Scan failed."),
    });

  const runDispatch = (p: SupervisorProposal) =>
    dispatch.mutate(p.id, {
      onSuccess: (r) =>
        toast.success(
          r.alreadyDispatched
            ? "Already dispatched — reusing the existing run."
            : `Dispatched — run ${r.runId?.slice(0, 8) ?? "started"}.`,
        ),
      onError: (err) => toast.error(dispatchErrorMessage(err)),
    });

  return (
    <div className="flex flex-col h-full border-l">
      <div className="px-3 py-2 border-b flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Supervisor — cross-project proposals</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs ml-auto"
          onClick={runScan}
          disabled={scan.isPending}
        >
          {scan.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Scan
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading proposals…
            </div>
          ) : proposals.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No proposals yet. Run a scan to surface the highest-value cross-project work.
            </div>
          ) : (
            proposals.map((p) => {
              const meta = (p.metadata ?? {}) as ProposalMeta;
              const dispatched = !!meta.dispatchedRunId;
              const dispatching = dispatch.isPending && dispatch.variables === p.id;
              return (
                <div key={p.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {SIGNAL_LABEL[meta.signalType ?? ""] ?? meta.signalType ?? "signal"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {projectName(p.projectId)}
                    </span>
                    {typeof meta.score === "number" && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        score {meta.score}
                      </span>
                    )}
                  </div>

                  <div className="text-sm font-medium leading-snug">{p.title}</div>
                  {p.description && (
                    <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                      {p.description}
                    </p>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <Badge variant="outline" className="text-[10px]">
                      {p.status}
                    </Badge>
                    {dispatched ? (
                      <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3" /> dispatched
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto h-7 gap-1.5 text-xs"
                        onClick={() => runDispatch(p)}
                        disabled={dispatching}
                      >
                        {dispatching ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        Dispatch
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
