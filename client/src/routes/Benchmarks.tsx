import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Play, RefreshCw, X } from "lucide-react";
import {
  useBenchmarkRuns,
  useBenchmarkRun,
  useBenchmarkFixtures,
  useBenchmarkAggregate,
  useBenchmarkActive,
  useTriggerBenchmark,
} from "@/hooks";
import type { BenchResult, BenchTriggerInput } from "@/lib/api";

function fmtCost(usd: number | null | undefined): string {
  if (typeof usd !== "number" || usd === 0) return "—";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtMs(ms: number | null | undefined): string {
  if (typeof ms !== "number") return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "SOLVED") return "default";
  if (status === "TARGET-ONLY") return "secondary";
  if (status === "MIS-FIXTURE" || status === "TAMPERED" || status === "ERROR") return "destructive";
  return "outline";
}

function ResultRow({ r, onRerun }: { r: BenchResult; onRerun: (fixtureId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-md">
      <div className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 flex-1 text-left">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
            <Badge variant={statusVariant(r.status)} className="font-mono text-[10px]">{r.status}</Badge>
            <span className="font-medium text-sm">{r.fixtureId}</span>
            <span className="text-muted-foreground/70 text-xs truncate">{r.title}</span>
          </button>
        </CollapsibleTrigger>
        <span className="text-xs text-muted-foreground tabular-nums">+{r.diff.linesAdded}/-{r.diff.linesRemoved}</span>
        <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">{fmtMs(r.durationMs)}</span>
        <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">{fmtCost(r.ai.totalCostUsd)}</span>
        <Button size="sm" variant="ghost" onClick={() => onRerun(r.fixtureId)} title="Re-run this fixture">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      <CollapsibleContent className="px-3 pb-3 space-y-2 border-t bg-muted/20">
        <div className="grid grid-cols-2 gap-3 text-xs pt-2">
          <div>
            <div className="font-medium mb-0.5">Tests</div>
            <div className="text-muted-foreground">target: {r.tests.targetPassed ? "PASS" : "FAIL"} (exit {r.tests.targetExitCode})</div>
            <div className="text-muted-foreground">regression: {r.tests.regressionsHeld ? "HOLD" : "BROKE"} (exit {r.tests.regressionExitCode})</div>
          </div>
          <div>
            <div className="font-medium mb-0.5">Diff</div>
            <div className="text-muted-foreground">files: {r.diff.filesChanged.length} ({r.diff.filesChanged.join(", ") || "none"})</div>
            <div className="text-muted-foreground">budget: {r.diff.withinBudget ? "ok" : "over"} · expected-only: {r.diff.expectedFilesOnly ? "yes" : "no"}</div>
          </div>
          {r.ai.invoked && (
            <div>
              <div className="font-medium mb-0.5">AI</div>
              <div className="text-muted-foreground">models: {r.ai.models.join(", ") || "—"}</div>
              <div className="text-muted-foreground">turns: {r.ai.numTurns ?? "—"} · tokens: {r.ai.inputTokens ?? "—"}/{r.ai.outputTokens ?? "—"}</div>
              <div className="text-muted-foreground">stop: {r.ai.stopReason ?? "—"}</div>
            </div>
          )}
          {r.chain.depth > 0 && (
            <div>
              <div className="font-medium mb-0.5">Chain</div>
              <div className="text-muted-foreground">depth: {r.chain.depth} · expected: {r.chain.expectedDepth ?? "—"} · met: {r.chain.expectedDepthMet ? "yes" : "no"}</div>
              <div className="text-muted-foreground">leaf: {r.chain.leafTaskId ? `${r.chain.leafTaskId.slice(0, 8)} (${r.chain.leafStatus})` : "—"}</div>
            </div>
          )}
          {r.sideEffects.checked && (
            <div>
              <div className="font-medium mb-0.5">Side-effects</div>
              <div className="text-muted-foreground">allGreen: {r.sideEffects.allGreen ? "yes" : "no"}</div>
              <div className="text-muted-foreground">aiRun: {r.sideEffects.taskAiRun.found ? "found" : "—"} · snapshot: {r.sideEffects.snapshot.fileExists ? "yes" : "no"}</div>
            </div>
          )}
          {r.error && (
            <div className="col-span-2">
              <div className="font-medium mb-0.5 text-destructive">Error</div>
              <pre className="bg-muted/40 p-1.5 rounded text-[11px] overflow-auto max-h-32">{r.error}</pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TriggerPanel({ onClose }: { onClose: () => void }) {
  const { data: fxData } = useBenchmarkFixtures();
  const trigger = useTriggerBenchmark();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mock, setMock] = useState(true);
  const [mockClaude, setMockClaude] = useState(false);
  const [mode, setMode] = useState<"harness" | "pipeline">("harness");
  const [parallel, setParallel] = useState(1);

  const handleSubmit = () => {
    const input: BenchTriggerInput = {
      fixtures: [...picked],
      mock,
      mockClaude,
      mode,
      parallel,
    };
    trigger.mutate(input, { onSuccess: onClose });
  };

  return (
    <div className="border rounded-md p-4 space-y-4 bg-muted/20">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Trigger benchmark run</h3>
        <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div>
        <Label className="text-xs">Fixtures (none = all)</Label>
        <div className="grid grid-cols-2 gap-1 mt-1 max-h-48 overflow-auto border rounded p-2">
          {(fxData?.fixtures ?? []).map((f) => (
            <label key={f.id} className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox
                checked={picked.has(f.id)}
                onCheckedChange={(v) => {
                  setPicked((prev) => {
                    const n = new Set(prev);
                    if (v) n.add(f.id);
                    else n.delete(f.id);
                    return n;
                  });
                }}
              />
              <span className="font-mono">{f.id}</span>
              <span className="text-muted-foreground/60 text-[10px]">{f.difficulty}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 flex-wrap text-xs">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={mock} onCheckedChange={(v) => setMock(!!v)} />
          --mock (use fixture mockFix, no AI)
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={mockClaude} onCheckedChange={(v) => setMockClaude(!!v)} />
          --mock-claude (pipeline shim)
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={mode === "pipeline"} onCheckedChange={(v) => setMode(v ? "pipeline" : "harness")} />
          --mode=pipeline
        </label>
        <label className="flex items-center gap-2">
          parallel
          <Input
            type="number"
            min={1}
            max={4}
            value={parallel}
            onChange={(e) => setParallel(Math.max(1, Math.min(4, parseInt(e.target.value) || 1)))}
            className="w-16 h-7 text-xs"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleSubmit} disabled={trigger.isPending}>
          <Play className="h-3.5 w-3.5 mr-1" /> {trigger.isPending ? "Triggering…" : "Trigger run"}
        </Button>
      </div>
      {trigger.isError && (
        <div className="text-xs text-destructive">Error: {(trigger.error as Error)?.message ?? "Failed"}</div>
      )}
    </div>
  );
}

export default function Benchmarks() {
  const [params, setParams] = useSearchParams();
  const selectedRunId = params.get("run");
  const [showTrigger, setShowTrigger] = useState(false);
  const { data: runsData, isLoading } = useBenchmarkRuns();
  const { data: aggregate } = useBenchmarkAggregate();
  const { data: active } = useBenchmarkActive();
  const { data: detail } = useBenchmarkRun(selectedRunId);
  const trigger = useTriggerBenchmark();

  const runs = runsData?.runs ?? [];
  const activeRuns = active?.runs ?? [];

  const selectRun = (id: string | null) => {
    if (id) {
      setParams({ run: id });
    } else {
      setParams({});
    }
  };

  const handleRerunFixture = (fixtureId: string) => {
    trigger.mutate({ fixtures: [fixtureId], mock: true, mode: "harness" });
  };

  const handleRerunFullReport = () => {
    if (!detail) return;
    const fixtures = detail.results.map((r) => r.fixtureId);
    trigger.mutate({ fixtures, mock: true, mode: "harness" });
  };

  const topByFixture = useMemo(() => {
    if (!aggregate) return [];
    return [...aggregate.byFixture].sort((a, b) => a.solveRate - b.solveRate).slice(0, 5);
  }, [aggregate]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Benchmarks</h1>
          <p className="text-sm text-muted-foreground/70 mt-0.5">
            {runs.length} runs · {aggregate?.resultsScanned ?? 0} results · total cost {fmtCost(aggregate?.totalCostUsd)}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowTrigger(true)} disabled={showTrigger}>
          <Play className="h-3.5 w-3.5 mr-1.5" /> New run
        </Button>
      </div>

      {showTrigger && <TriggerPanel onClose={() => setShowTrigger(false)} />}

      {activeRuns.length > 0 && (
        <div className="border rounded-md p-3 space-y-2">
          <h3 className="text-sm font-semibold">Active runs</h3>
          {activeRuns.map((r) => (
            <div key={r.runId} className="flex items-center gap-3 text-xs">
              <Badge variant={r.status === "running" ? "secondary" : r.status === "done" ? "default" : "destructive"}>
                {r.status}
              </Badge>
              <span className="font-mono">{r.runId}</span>
              <span className="text-muted-foreground/70 truncate flex-1">{r.args.join(" ")}</span>
              <span className="text-muted-foreground tabular-nums">{new Date(r.startedAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}

      {topByFixture.length > 0 && (
        <div className="border rounded-md p-3 space-y-2">
          <h3 className="text-sm font-semibold">Hardest fixtures (lowest solve rate)</h3>
          <div className="space-y-1">
            {topByFixture.map((b) => (
              <div key={b.key} className="flex items-center gap-3 text-xs">
                <span className="font-mono w-48 truncate">{b.key}</span>
                <span className="text-muted-foreground tabular-nums w-16">{(b.solveRate * 100).toFixed(0)}%</span>
                <span className="text-muted-foreground tabular-nums w-12">{b.solved}/{b.total}</span>
                <span className="text-muted-foreground tabular-nums w-16 text-right">{fmtCost(b.totalCostUsd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border rounded-md">
        <div className="px-3 py-2 border-b bg-muted/30 flex items-center text-xs font-medium text-muted-foreground">
          <span className="flex-1">Run</span>
          <span className="w-20 text-right">Solved</span>
          <span className="w-20 text-right">Duration</span>
          <span className="w-20 text-right">Cost</span>
        </div>
        {isLoading ? (
          <div className="p-3 space-y-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : runs.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No runs yet. Trigger one to get started.</div>
        ) : (
          <div className="divide-y">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => selectRun(r.id === selectedRunId ? null : r.id)}
                className={`w-full flex items-center px-3 py-2 hover:bg-muted/40 text-left ${r.id === selectedRunId ? "bg-muted/40" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs truncate">{r.id}</div>
                  <div className="text-[10px] text-muted-foreground/70 truncate">{r.models.join(", ") || "no AI"}</div>
                </div>
                <span className="w-20 text-right text-xs tabular-nums">
                  {r.solvedCount ?? "—"}/{r.count}
                </span>
                <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">{fmtMs(r.totalMs)}</span>
                <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">{fmtCost(r.totalCostUsd)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedRunId && detail && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Run {selectedRunId}</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleRerunFullReport} disabled={trigger.isPending}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Re-run all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => selectRun(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {detail.results.map((r) => (
              <ResultRow key={`${r.fixtureId}-${r.runId}`} r={r} onRerun={handleRerunFixture} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
