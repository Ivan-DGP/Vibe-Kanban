import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Check, Sparkles } from "lucide-react";
import { useReport, useGenerateReportSummary } from "@/hooks";
import { PERIOD_OPTIONS } from "@/lib/constants";
import { reportToMarkdown, copyToClipboard } from "@/lib/markdown-export";
import ReportSummary from "@/components/reports/ReportSummary";
import ReportProjectGroup from "@/components/reports/ReportProjectGroup";
import ReportMarkdownView from "@/components/reports/ReportMarkdownView";

export default function Reports() {
  const [period, setPeriod] = useState("this-week");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState(false);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const generateSummary = useGenerateReportSummary();

  const params =
    period === "custom" ? { period, from: from || undefined, to: to || undefined } : { period };

  const { data: report, isLoading } = useReport(params);

  const handleCopy = async () => {
    if (!report) return;
    await copyToClipboard(reportToMarkdown(report));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateSummaries = async () => {
    if (!report) return;
    const ids = report.byProject.flatMap((g) => g.tasks.map((t) => t.task.id));
    for (let i = 0; i < ids.length; i++) {
      setProgress(`Generating ${i + 1}/${ids.length}…`);
      try {
        await generateSummary.mutateAsync(ids[i]);
      } catch (err) {
        console.error("Summary generation failed", ids[i], err);
      }
    }
    setProgress(null);
    await queryClient.invalidateQueries({ queryKey: ["report"] });
    toast.success("Summaries generated");
  };

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Reports</h1>
        <div className="flex items-center gap-2">
          {progress && <span className="text-xs text-muted-foreground">{progress}</span>}
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateSummaries}
            disabled={!report || report.totalTasks === 0 || progress !== null}
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Generate summaries
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowMarkdown((v) => !v)}>
            {showMarkdown ? "View Report" : "View Markdown"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={!report || report.totalTasks === 0}
          >
            {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {copied ? "Copied!" : "Copy as Markdown"}
          </Button>
        </div>
      </div>

      <div className="flex items-end gap-3 mb-6">
        <div className="space-y-1">
          <Label className="text-xs">Period</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {period === "custom" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-[160px]"
              />
            </div>
          </>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-40" />
        </div>
      ) : report ? (
        showMarkdown ? (
          <ReportMarkdownView markdown={reportToMarkdown(report)} />
        ) : (
          <div className="space-y-6">
            <ReportSummary
              totalTasks={report.totalTasks}
              totalHours={report.totalHours}
              avgHoursPerTask={report.avgHoursPerTask}
            />

            {report.byProject.length > 0 ? (
              <div className="space-y-2">
                {report.byProject.map((group) => (
                  <ReportProjectGroup
                    key={group.projectId}
                    projectName={group.projectName}
                    tasks={group.tasks}
                    totalHours={group.totalHours}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No completed tasks in this period
              </p>
            )}
          </div>
        )
      ) : null}
    </div>
  );
}
