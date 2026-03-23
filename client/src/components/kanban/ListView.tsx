import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PriorityBadge from "@/components/tasks/PriorityBadge";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS } from "@/lib/constants";
import { ListTodo } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Task } from "@vibe-kanban/shared";

interface ListViewProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

export default function ListView({ tasks, onTaskClick }: ListViewProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border/40 hover:bg-transparent">
            <TableHead className="text-xs font-semibold">Title</TableHead>
            <TableHead className="w-[80px] text-xs font-semibold">Priority</TableHead>
            <TableHead className="w-[100px] text-xs font-semibold">Status</TableHead>
            <TableHead className="w-[120px] text-xs font-semibold">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TableRow
              key={task.id}
              className="cursor-pointer hover:bg-accent/50 border-border/30 transition-colors"
              onClick={() => onTaskClick(task)}
            >
              <TableCell className="font-medium">{task.title}</TableCell>
              <TableCell><PriorityBadge priority={task.priority} /></TableCell>
              <TableCell>
                <Badge variant="secondary" className="text-[10px]">
                  {STATUS_LABELS[task.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
              </TableCell>
            </TableRow>
          ))}
          {tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                <div className="flex flex-col items-center gap-2">
                  <ListTodo className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm">No tasks found</p>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
