import { cn } from "@/lib/utils";
import type { CIStatus, CICheckResult } from "@vibe-kanban/shared";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CIStatusBadgeProps {
  ciResult: CICheckResult | undefined;
  className?: string;
}

const STATUS_CONFIG: Record<CIStatus, { color: string; bgColor: string; label: string; animate?: boolean }> = {
  success: { color: "bg-green-500", bgColor: "bg-green-500/15", label: "CI Passed" },
  failure: { color: "bg-red-500", bgColor: "bg-red-500/15", label: "CI Failed" },
  pending: { color: "bg-yellow-500", bgColor: "bg-yellow-500/15", label: "CI Pending", animate: true },
  running: { color: "bg-yellow-500", bgColor: "bg-yellow-500/15", label: "CI Running", animate: true },
  unknown: { color: "bg-muted-foreground/40", bgColor: "bg-muted-foreground/10", label: "No CI data" },
};

export default function CIStatusBadge({ ciResult, className }: CIStatusBadgeProps) {
  if (!ciResult || ciResult.status === "unknown") return null;

  const config = STATUS_CONFIG[ciResult.status];

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={ciResult.runUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              if (!ciResult.runUrl) e.preventDefault();
            }}
            className={cn("inline-flex items-center gap-1 shrink-0", className)}
          >
            <span className={cn("relative flex h-2.5 w-2.5")}>
              {config.animate && (
                <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", config.color)} />
              )}
              <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", config.color)} />
            </span>
          </a>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="font-medium">{config.label}</div>
          {ciResult.workflowName && <div className="text-muted-foreground">{ciResult.workflowName}</div>}
          {ciResult.conclusion && ciResult.conclusion !== ciResult.status && (
            <div className="text-muted-foreground">Conclusion: {ciResult.conclusion}</div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
