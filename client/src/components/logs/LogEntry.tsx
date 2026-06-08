import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import { LOG_LEVEL_COLORS } from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";
import type { SystemLog } from "@vibe-kanban/shared";

interface LogEntryProps {
  log: SystemLog;
}

export default function LogEntry({ log }: LogEntryProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded px-3 py-2">
      <div
        className="flex items-center gap-2 text-xs cursor-pointer"
        onClick={() => log.details && setExpanded(!expanded)}
      >
        {log.details &&
          (expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          ))}
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 py-0 ${LOG_LEVEL_COLORS[log.level]}`}
        >
          {log.level}
        </Badge>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {log.category}
        </Badge>
        <span className="flex-1 truncate">{log.message}</span>
        <span className="text-muted-foreground shrink-0">
          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
        </span>
      </div>
      {expanded && log.details && (
        <pre className="mt-2 text-[10px] bg-muted rounded p-2 overflow-x-auto">
          {typeof log.details === "string" ? log.details : JSON.stringify(log.details, null, 2)}
        </pre>
      )}
    </div>
  );
}
