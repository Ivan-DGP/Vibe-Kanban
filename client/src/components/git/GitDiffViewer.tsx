import { ScrollArea } from "@/components/ui/scroll-area";
import { useGitDiff } from "@/hooks";

interface GitDiffViewerProps {
  projectId: string;
  file?: string;
  subPath?: string;
}

export default function GitDiffViewer({ projectId, file, subPath }: GitDiffViewerProps) {
  const { data: diff, isLoading } = useGitDiff(projectId, file, subPath);

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading diff...</p>;
  if (!diff) return <p className="text-xs text-muted-foreground">No changes</p>;

  const lines = diff.split("\n");

  return (
    <ScrollArea className="max-h-[400px] rounded border">
      <pre className="text-xs p-2 font-mono">
        {lines.map((line, i) => {
          let color = "";
          if (line.startsWith("+") && !line.startsWith("+++")) color = "text-green-500";
          else if (line.startsWith("-") && !line.startsWith("---")) color = "text-red-500";
          else if (line.startsWith("@@")) color = "text-blue-400";
          return (
            <div key={i} className={color}>
              {line}
            </div>
          );
        })}
      </pre>
    </ScrollArea>
  );
}
