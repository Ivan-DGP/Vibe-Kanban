import { ScrollArea } from "@/components/ui/scroll-area";
import { useGitLog } from "@/hooks";
import { formatDistanceToNow } from "date-fns";

interface GitLogPanelProps {
  projectId: string;
  subPath?: string;
}

export default function GitLogPanel({ projectId, subPath }: GitLogPanelProps) {
  const { data: log } = useGitLog(projectId, subPath);

  if (!log || log.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No commits yet</p>;
  }

  return (
    <ScrollArea className="max-h-[200px]">
      <div className="space-y-1">
        {log.map((entry) => (
          <div key={entry.hash} className="flex items-start gap-2 px-1 py-1 text-xs rounded hover:bg-accent">
            <span className="font-mono text-muted-foreground shrink-0">{entry.hashShort}</span>
            <span className="flex-1 line-clamp-1">{entry.message}</span>
            <span className="text-muted-foreground shrink-0">
              {formatDistanceToNow(new Date(entry.date), { addSuffix: true })}
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
