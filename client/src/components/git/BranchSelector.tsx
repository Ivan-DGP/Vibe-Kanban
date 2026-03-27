import { useState, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitBranch, Check, Plus, X } from "lucide-react";
import { useGitBranches } from "@/hooks";

interface BranchSelectorProps {
  projectId: string;
  value: string | null;
  onSelect: (branch: string | null) => void;
  disabled?: boolean;
}

export default function BranchSelector({ projectId, value, onSelect, disabled }: BranchSelectorProps) {
  const { data: branches } = useGitBranches(projectId);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const localBranches = useMemo(
    () => (branches?.filter((b) => !b.remote) ?? []),
    [branches],
  );

  const filtered = useMemo(() => {
    if (!filter.trim()) return localBranches;
    const q = filter.toLowerCase();
    return localBranches.filter((b) => b.name.toLowerCase().includes(q));
  }, [localBranches, filter]);

  const exactMatch = localBranches.some((b) => b.name === filter.trim());
  const showCreate = filter.trim() && !exactMatch;

  const handleSelect = (branch: string | null) => {
    onSelect(branch);
    setOpen(false);
    setFilter("");
  };

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setFilter(""); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 justify-start font-normal min-w-0 max-w-[220px]"
            disabled={disabled}
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-mono">
              {value || "Current branch"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter or create branch..."
            className="h-7 text-xs mb-2"
            autoFocus
          />
          <ScrollArea className="max-h-[250px]">
            {/* Current branch option (null) */}
            <button
              className="flex items-center gap-2 w-full px-2 py-1 text-xs rounded hover:bg-accent"
              onClick={() => handleSelect(null)}
            >
              {value === null && <Check className="h-3 w-3" />}
              <span className={value === null ? "font-medium" : "ml-5"}>
                Current branch
              </span>
            </button>

            {/* Existing local branches */}
            {filtered.length > 0 && (
              <div className="mt-1 pt-1 border-t">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                  Branches
                </div>
                {filtered.map((b) => (
                  <button
                    key={b.name}
                    className="flex items-center gap-2 w-full px-2 py-1 text-xs rounded hover:bg-accent"
                    onClick={() => handleSelect(b.name)}
                  >
                    {value === b.name && <Check className="h-3 w-3" />}
                    <span className={`font-mono truncate ${value === b.name ? "font-medium" : "ml-5"}`}>
                      {b.name}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Create new branch option */}
            {showCreate && (
              <div className="mt-1 pt-1 border-t">
                <button
                  className="flex items-center gap-2 w-full px-2 py-1 text-xs rounded hover:bg-accent text-primary"
                  onClick={() => handleSelect(filter.trim())}
                >
                  <Plus className="h-3 w-3" />
                  <span className="font-mono truncate">Create: {filter.trim()}</span>
                </button>
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>

      {/* Clear button when a branch is selected */}
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onSelect(null)}
          disabled={disabled}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
