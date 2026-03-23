import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2 } from "lucide-react";
import { useLogs, useClearLogs } from "@/hooks";
import LogEntry from "@/components/logs/LogEntry";
import LogFilters from "@/components/logs/LogFilters";
import { format, isToday, isYesterday } from "date-fns";

export default function Logs() {
  const [level, setLevel] = useState("all");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(50);

  const params = {
    level: level === "all" ? undefined : level,
    category: category === "all" ? undefined : category,
    limit,
    offset: 0,
  };

  const { data, isLoading } = useLogs(params);
  const clearLogs = useClearLogs();

  const logs = data?.items ?? [];
  const total = data?.total ?? 0;

  const grouped = useMemo(() => {
    const groups: { label: string; logs: typeof logs }[] = [];
    let currentLabel = "";
    for (const log of logs) {
      const date = new Date(log.createdAt);
      let label: string;
      if (isToday(date)) label = "Today";
      else if (isYesterday(date)) label = "Yesterday";
      else label = format(date, "MMM d, yyyy");
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, logs: [] });
      }
      groups[groups.length - 1].logs.push(log);
    }
    return groups;
  }, [logs]);

  const handleClear = () => {
    if (!confirm("Clear all logs?")) return;
    clearLogs.mutate();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Logs</h1>
          <p className="text-sm text-muted-foreground/70 mt-0.5">{total} entries</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleClear} disabled={clearLogs.isPending || total === 0}>
          <Trash2 className="h-4 w-4 mr-1" />
          Clear Logs
        </Button>
      </div>

      <div className="mb-4">
        <LogFilters
          level={level}
          category={category}
          onLevelChange={setLevel}
          onCategoryChange={setCategory}
          total={total}
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No logs found</p>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider mb-2 px-1">
                {group.label}
              </div>
              <div className="space-y-1.5">
                {group.logs.map((log) => (
                  <LogEntry key={log.id} log={log} />
                ))}
              </div>
            </div>
          ))}
          {logs.length < total && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground"
              onClick={() => setLimit((l) => l + 50)}
            >
              Load more ({total - logs.length} remaining)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
