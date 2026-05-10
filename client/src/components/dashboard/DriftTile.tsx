import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useBenchmarkDrift } from "@/hooks/useBenchmarks";

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "never";
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

export default function DriftTile() {
  const { data, isLoading } = useBenchmarkDrift();
  if (isLoading || !data || data.totalCaptures === 0) return null;

  const top = data.byProject.slice(0, 4);
  return (
    <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-6 w-6 rounded-full bg-amber-500/15 flex items-center justify-center">
          <Activity className="h-3.5 w-3.5 text-amber-400" />
        </div>
        <span className="text-sm font-medium">Bench Capture</span>
        <Badge variant="secondary" className="text-xs">
          {data.totalCaptures}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {data.projectCount} project{data.projectCount === 1 ? "" : "s"} · last{" "}
          {formatRelative(data.latestCaptureAt)}
        </span>
      </div>
      {top.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {top.map((p) => {
            const failed = p.lastExitCode !== null && p.lastExitCode !== 0;
            return (
              <div
                key={p.hash}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-sm shrink-0"
              >
                <span
                  className={`h-2 w-2 rounded-full ${failed ? "bg-red-400" : "bg-emerald-400"}`}
                />
                <span className="font-mono text-xs text-muted-foreground">
                  {p.hash.slice(0, 8)}
                </span>
                <span className="text-xs">×{p.count}</span>
                <span className="text-xs text-muted-foreground">{formatRelative(p.lastAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
