import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import type { AiPreflightResult } from "@vibe-kanban/shared";

export default function TaskViewerPreflight({
  preflight,
}: {
  preflight: AiPreflightResult | null;
}) {
  if (!preflight) return null;

  return (
    <>
      <Separator />
      <div className="space-y-1.5 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{preflight.effectiveProfile}</Badge>
          <Badge variant={preflight.scope === "large" ? "default" : "secondary"}>
            {preflight.scope} scope
          </Badge>
          {preflight.detectedProfile !== preflight.effectiveProfile && (
            <span className="text-muted-foreground">detected: {preflight.detectedProfile}</span>
          )}
        </div>
        {preflight.warnings.length > 0 && (
          <div className="space-y-0.5">
            {preflight.warnings.map((w, i) => (
              <p key={i} className="text-yellow-600 dark:text-yellow-400">
                {w}
              </p>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
