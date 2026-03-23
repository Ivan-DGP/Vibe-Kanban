import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FolderSearch, Loader2 } from "lucide-react";
import { useScanProjects, useCreateProject } from "@/hooks";
import type { ScannedProject } from "@vibe-kanban/shared";

export default function ProjectScanSection() {
  const [dirs, setDirs] = useState("");
  const [scanned, setScanned] = useState<ScannedProject[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const scan = useScanProjects();
  const create = useCreateProject();

  const handleScan = () => {
    const list = dirs.split("\n").map((d) => d.trim()).filter(Boolean);
    if (list.length === 0) return;
    scan.mutate(list, {
      onSuccess: (results) => { setScanned(results); setSelected(new Set(results.map((_, i) => i))); },
    });
  };

  const handleAdd = async () => {
    for (const [i, p] of scanned.entries()) {
      if (selected.has(i)) await create.mutateAsync({ name: p.name, path: p.path });
    }
    setScanned([]);
    setSelected(new Set());
  };

  return (
    <div className="space-y-3">
      <Label>Scan Directories</Label>
      <textarea
        value={dirs}
        onChange={(e) => setDirs(e.target.value)}
        placeholder="One directory per line..."
        className="w-full min-h-[60px] rounded-md border bg-background px-3 py-2 text-sm"
        rows={3}
      />
      <Button variant="outline" size="sm" onClick={handleScan} disabled={scan.isPending}>
        {scan.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FolderSearch className="h-4 w-4 mr-1" />}
        Scan
      </Button>

      {scanned.length > 0 && (
        <ScrollArea className="h-[200px] border rounded-md p-2">
          {scanned.map((p, i) => (
            <label key={i} className="flex items-start gap-2 p-1.5 rounded hover:bg-accent cursor-pointer">
              <Checkbox checked={selected.has(i)} onCheckedChange={() => {
                const s = new Set(selected);
                s.has(i) ? s.delete(i) : s.add(i);
                setSelected(s);
              }} />
              <div>
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.path}</div>
                <div className="flex gap-1 mt-0.5">
                  {p.techStack.map((t) => <Badge key={t} variant="outline" className="text-[10px] px-1 py-0">{t}</Badge>)}
                </div>
              </div>
            </label>
          ))}
        </ScrollArea>
      )}

      {scanned.length > 0 && selected.size > 0 && (
        <Button size="sm" onClick={handleAdd} disabled={create.isPending}>
          Add {selected.size} project{selected.size !== 1 ? "s" : ""}
        </Button>
      )}
    </div>
  );
}
