import { Badge } from "@/components/ui/badge";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/constants";
import type { TaskPriority } from "@vibe-kanban/shared";

interface PriorityBadgeProps {
  priority: TaskPriority;
  className?: string;
}

export default function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 ${PRIORITY_COLORS[priority]} ${className ?? ""}`}
    >
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}
