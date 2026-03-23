import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import PriorityBadge from "@/components/tasks/PriorityBadge";
import type { ReportEntry } from "@vibe-kanban/shared";

interface ReportProjectGroupProps {
  projectName: string;
  tasks: ReportEntry[];
  totalHours: number;
}

export default function ReportProjectGroup({ projectName, tasks, totalHours }: ReportProjectGroupProps) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 hover:bg-accent rounded px-2">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="font-medium text-sm">{projectName}</span>
        <Badge variant="secondary" className="text-xs">{tasks.length} tasks</Badge>
        <span className="text-xs text-muted-foreground ml-auto">{totalHours.toFixed(1)}h</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead className="w-[80px]">Priority</TableHead>
              <TableHead className="w-[80px] text-right">Hours</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((entry) => (
              <TableRow key={entry.task.id}>
                <TableCell className="text-sm">{entry.task.title}</TableCell>
                <TableCell><PriorityBadge priority={entry.task.priority} /></TableCell>
                <TableCell className="text-right text-sm">{entry.hours.toFixed(1)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  );
}
