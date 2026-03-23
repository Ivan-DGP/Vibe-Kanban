import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Target, Plus, Check } from "lucide-react";
import { useMilestones, useCreateMilestone } from "@/hooks";
import { useAppStore } from "@/stores/appStore";

interface MilestoneSelectorProps {
  projectId: string;
}

export default function MilestoneSelector({ projectId }: MilestoneSelectorProps) {
  const { data: milestones } = useMilestones(projectId);
  const createMilestone = useCreateMilestone(projectId);
  const { activeMilestones, setActiveMilestone } = useAppStore();
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);

  const activeMilestoneId = activeMilestones[projectId] ?? null;
  const activeName = milestones?.find((m) => m.id === activeMilestoneId)?.name ?? "General";

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMilestone.mutate({ name: newName.trim() }, {
      onSuccess: (m) => {
        setActiveMilestone(projectId, m.id);
        setNewName("");
      },
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Target className="h-3.5 w-3.5" />
          {activeName}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1">
          <button
            onClick={() => { setActiveMilestone(projectId, null); setOpen(false); }}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent"
          >
            {activeMilestoneId === null && <Check className="h-3.5 w-3.5" />}
            <span className={activeMilestoneId === null ? "" : "ml-5"}>General</span>
          </button>

          {milestones?.filter((m) => m.status === "active").map((m) => (
            <button
              key={m.id}
              onClick={() => { setActiveMilestone(projectId, m.id); setOpen(false); }}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent"
            >
              {activeMilestoneId === m.id && <Check className="h-3.5 w-3.5" />}
              <span className={activeMilestoneId === m.id ? "" : "ml-5"}>{m.name}</span>
            </button>
          ))}
        </div>

        <Separator className="my-2" />

        <div className="flex gap-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="New milestone..."
            className="h-7 text-xs"
          />
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleCreate} disabled={!newName.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
