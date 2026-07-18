import { Separator } from "@/components/ui/separator";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function TaskViewerAnalysis({ analysis }: { analysis: string | null }) {
  if (!analysis) return null;

  return (
    <>
      <Separator />
      <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
          AI Analysis
        </div>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
      </div>
    </>
  );
}
