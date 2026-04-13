import { useState, useMemo } from "react";
import { useRoadmap, useCreateRoadmapItem, useUpdateRoadmapItem, useDeleteRoadmapItem } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, GripVertical, Calendar } from "lucide-react";
import type { RoadmapItem, RoadmapItemStatus } from "@vibe-kanban/shared";

const STATUS_COLORS: Record<RoadmapItemStatus, string> = {
  planned: "bg-slate-500",
  in_progress: "bg-blue-500",
  completed: "bg-green-500",
  blocked: "bg-red-500",
};

const STATUS_LABELS: Record<RoadmapItemStatus, string> = {
  planned: "Planned",
  in_progress: "In Progress",
  completed: "Completed",
  blocked: "Blocked",
};

const LANE_COLORS = [
  "bg-blue-500/20 border-blue-500/30",
  "bg-purple-500/20 border-purple-500/30",
  "bg-green-500/20 border-green-500/30",
  "bg-amber-500/20 border-amber-500/30",
  "bg-cyan-500/20 border-cyan-500/30",
  "bg-pink-500/20 border-pink-500/30",
];

interface RoadmapTabProps {
  projectId: string;
}

export default function RoadmapTab({ projectId }: RoadmapTabProps) {
  const { data: items = [], isLoading } = useRoadmap(projectId);
  const createItem = useCreateRoadmapItem(projectId);
  const updateItem = useUpdateRoadmapItem(projectId);
  const deleteItem = useDeleteRoadmapItem(projectId);
  const [editingItem, setEditingItem] = useState<RoadmapItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Calculate timeline bounds
  const { minDate, maxDate, totalDays } = useMemo(() => {
    const datesWithValues = items.filter((i) => i.startDate || i.endDate);
    if (!datesWithValues.length) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 3, 0);
      return {
        minDate: start,
        maxDate: end,
        totalDays: Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
      };
    }
    const allDates = datesWithValues.flatMap((i) => [
      i.startDate ? new Date(i.startDate) : null,
      i.endDate ? new Date(i.endDate) : null,
    ]).filter(Boolean) as Date[];
    const min = new Date(Math.min(...allDates.map((d) => d.getTime())));
    const max = new Date(Math.max(...allDates.map((d) => d.getTime())));
    // Add padding
    min.setDate(min.getDate() - 7);
    max.setDate(max.getDate() + 14);
    return {
      minDate: min,
      maxDate: max,
      totalDays: Math.max(30, Math.ceil((max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24))),
    };
  }, [items]);

  const getBarStyle = (item: RoadmapItem) => {
    if (!item.startDate && !item.endDate) return { left: "5%", width: "20%" };
    const start = item.startDate ? new Date(item.startDate) : minDate;
    const end = item.endDate ? new Date(item.endDate) : new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
    const startOffset = (start.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
    const duration = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return {
      left: `${(startOffset / totalDays) * 100}%`,
      width: `${Math.max(3, (duration / totalDays) * 100)}%`,
    };
  };

  // Month markers
  const months = useMemo(() => {
    const result: { label: string; left: string }[] = [];
    const d = new Date(minDate);
    d.setDate(1);
    if (d < minDate) d.setMonth(d.getMonth() + 1);
    while (d <= maxDate) {
      const offset = (d.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
      result.push({
        label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        left: `${(offset / totalDays) * 100}%`,
      });
      d.setMonth(d.getMonth() + 1);
    }
    return result;
  }, [minDate, maxDate, totalDays]);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {items.length} item{items.length !== 1 ? "s" : ""}
        </h3>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Add Item
        </Button>
      </div>

      {/* Timeline */}
      {items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Calendar className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No roadmap items</p>
          <p className="text-xs mt-1">Add phases, milestones, and deliverables to visualize your project timeline</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          {/* Month headers */}
          <div className="relative h-8 bg-secondary/30 border-b">
            {months.map((m) => (
              <div
                key={m.label}
                className="absolute top-0 h-full flex items-center border-l border-border/40 px-2 text-[10px] text-muted-foreground"
                style={{ left: m.left }}
              >
                {m.label}
              </div>
            ))}
          </div>

          {/* Swim lanes */}
          {items.map((item, i) => {
            const barStyle = getBarStyle(item);
            const colorClass = LANE_COLORS[i % LANE_COLORS.length];
            return (
              <div
                key={item.id}
                className="relative h-12 border-b border-border/30 hover:bg-accent/20 cursor-pointer group"
                onClick={() => setEditingItem(item)}
              >
                {/* Grid lines */}
                {months.map((m) => (
                  <div
                    key={m.label}
                    className="absolute top-0 h-full border-l border-border/20"
                    style={{ left: m.left }}
                  />
                ))}
                {/* Bar */}
                <div
                  className={`absolute top-2 h-8 rounded-md border ${colorClass} flex items-center px-2 gap-1.5 overflow-hidden`}
                  style={barStyle}
                >
                  <div className={`h-2 w-2 rounded-full shrink-0 ${STATUS_COLORS[item.status]}`} />
                  <span className="text-xs font-medium truncate">{item.title}</span>
                </div>
                {/* Delete button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-2.5 h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); deleteItem.mutate(item.id); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <RoadmapItemDialog
        open={showCreate || !!editingItem}
        item={editingItem}
        onClose={() => { setShowCreate(false); setEditingItem(null); }}
        onSave={(data) => {
          if (editingItem) {
            updateItem.mutate({ id: editingItem.id, input: data });
          } else {
            createItem.mutate(data);
          }
          setShowCreate(false);
          setEditingItem(null);
        }}
      />
    </div>
  );
}

function RoadmapItemDialog({
  open,
  item,
  onClose,
  onSave,
}: {
  open: boolean;
  item: RoadmapItem | null;
  onClose: () => void;
  onSave: (data: any) => void;
}) {
  const [title, setTitle] = useState(item?.title || "");
  const [description, setDescription] = useState(item?.description || "");
  const [status, setStatus] = useState<RoadmapItemStatus>(item?.status || "planned");
  const [startDate, setStartDate] = useState(item?.startDate || "");
  const [endDate, setEndDate] = useState(item?.endDate || "");

  // Reset on open
  useState(() => {
    setTitle(item?.title || "");
    setDescription(item?.description || "");
    setStatus(item?.status || "planned");
    setStartDate(item?.startDate || "");
    setEndDate(item?.endDate || "");
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit Roadmap Item" : "New Roadmap Item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
          <Select value={status} onValueChange={(v) => setStatus(v as RoadmapItemStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABELS) as RoadmapItemStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Start Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">End Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              disabled={!title.trim()}
              onClick={() => onSave({
                title: title.trim(),
                description: description || undefined,
                status,
                startDate: startDate || undefined,
                endDate: endDate || undefined,
              })}
            >
              {item ? "Update" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
