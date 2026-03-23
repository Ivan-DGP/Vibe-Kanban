import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Clock, TrendingUp } from "lucide-react";

interface ReportSummaryProps {
  totalTasks: number;
  totalHours: number;
  avgHoursPerTask: number;
}

export default function ReportSummary({ totalTasks, totalHours, avgHoursPerTask }: ReportSummaryProps) {
  const stats = [
    { label: "Tasks Completed", value: totalTasks, icon: CheckCircle2, color: "text-green-500" },
    { label: "Total Hours", value: totalHours.toFixed(1), icon: Clock, color: "text-blue-500" },
    { label: "Avg Hours/Task", value: avgHoursPerTask.toFixed(1), icon: TrendingUp, color: "text-purple-500" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="flex items-center gap-3 p-4">
            <stat.icon className={`h-8 w-8 ${stat.color}`} />
            <div>
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
