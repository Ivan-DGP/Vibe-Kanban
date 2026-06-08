import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  FolderSearch,
  Loader2,
  Folder,
  ArrowUp,
  ChevronRight,
  FolderKanban,
} from "lucide-react";
import { useCreateProject, useScanProjects } from "@/hooks";
import { api, type BrowseResult } from "@/lib/api";
import type { ScannedProject } from "@vibe-kanban/shared";

export default function AddProjectDialog() {
  const [open, setOpen] = useState(false);
  // Browse + manual unified
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [category, setCategory] = useState("");
  const [browseData, setBrowseData] = useState<BrowseResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  // Scan tab
  const [scanDirs, setScanDirs] = useState("");
  const [scanned, setScanned] = useState<ScannedProject[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const createProject = useCreateProject();
  const scanProjects = useScanProjects();

  // Browse with cooldown
  const navCooldownRef = useRef(false);
  const browseTo = async (dir?: string) => {
    if (navCooldownRef.current) return;
    navCooldownRef.current = true;
    setBrowseLoading(true);
    try {
      const result = await api.browse(dir);
      setBrowseData(result);
      // Update path input to reflect current browsed directory
      setProjectPath(result.current);
      setProjectName(result.current.split(/[\\/]/).pop() || "");
    } catch {
      // ignore
    }
    setBrowseLoading(false);
    setTimeout(() => {
      navCooldownRef.current = false;
    }, 400);
  };

  // Auto-browse to user home when dialog opens
  useEffect(() => {
    if (open && !browseData) browseTo();
  }, [open]);

  const handleBrowseTabOpen = () => {
    if (!browseData) browseTo();
  };

  // Navigate to pasted/typed path
  const handlePathSubmit = () => {
    if (projectPath.trim()) browseTo(projectPath.trim());
  };

  const handlePathKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handlePathSubmit();
    }
  };

  const handleAddProject = () => {
    const finalName = projectName.trim() || projectPath.trim().split(/[\\/]/).pop() || "";
    const finalPath = projectPath.trim();
    if (!finalName || !finalPath) return;
    createProject.mutate(
      { name: finalName, path: finalPath, category: category.trim() || undefined },
      {
        onSuccess: () => {
          setProjectName("");
          setProjectPath("");
          setCategory("");
          setOpen(false);
        },
      },
    );
  };

  const toggleFolderSelected = (folderPath: string) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  const handleAddSelectedFolders = async () => {
    for (const folderPath of selectedFolders) {
      const folderName = folderPath.split(/[\\/]/).pop() || folderPath;
      await createProject.mutateAsync({ name: folderName, path: folderPath });
    }
    setSelectedFolders(new Set());
    setOpen(false);
  };

  // Scan tab
  const handleScan = () => {
    const dirs = scanDirs
      .split("\n")
      .map((d) => d.trim())
      .filter(Boolean);
    if (dirs.length === 0) return;
    scanProjects.mutate(dirs, {
      onSuccess: (results) => {
        setScanned(results);
        setSelected(new Set(results.map((_, i) => i)));
      },
    });
  };

  const handleBulkAdd = async () => {
    const toAdd = scanned.filter((_, i) => selected.has(i));
    for (const p of toAdd) {
      await createProject.mutateAsync({ name: p.name, path: p.path });
    }
    setScanned([]);
    setSelected(new Set());
    setScanDirs("");
    setOpen(false);
  };

  const toggleSelected = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Add Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="browse">
          <TabsList className="w-full">
            <TabsTrigger value="browse" className="flex-1" onClick={handleBrowseTabOpen}>
              Browse
            </TabsTrigger>
            <TabsTrigger value="scan" className="flex-1">
              Scan
            </TabsTrigger>
          </TabsList>

          {/* Browse tab - path input + folder browser */}
          <TabsContent value="browse" className="space-y-3 mt-4">
            {/* Path input - paste or type */}
            <div className="space-y-2">
              <Label className="text-xs">Path</Label>
              <div className="flex gap-2">
                <Input
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  onKeyDown={handlePathKeyDown}
                  placeholder="Paste a path or browse below..."
                  className="flex-1 text-xs font-mono h-9"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  onClick={handlePathSubmit}
                  disabled={!projectPath.trim() || browseLoading}
                >
                  Go
                </Button>
              </div>
            </div>

            {/* Folder browser */}
            {browseData ? (
              <>
                {/* Navigation bar */}
                <div className="flex items-center gap-1.5 rounded-lg bg-secondary/40 border border-border/40 px-2 py-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => browseTo(browseData.parent)}
                    disabled={browseData.current === browseData.parent || browseLoading}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-[11px] font-mono text-muted-foreground truncate flex-1">
                    {browseData.current}
                  </span>
                  {browseLoading && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                  )}
                </div>

                {/* Folder list */}
                <ScrollArea className="h-[240px] border border-border/40 rounded-lg">
                  <div className="p-1">
                    {browseData.folders.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
                        <Folder className="h-8 w-8 mb-2" />
                        <p className="text-xs">No folders found</p>
                      </div>
                    ) : (
                      browseData.folders.map((folder) => (
                        <div
                          key={folder.path}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                            selectedFolders.has(folder.path)
                              ? "bg-primary/10"
                              : "hover:bg-accent/50"
                          }`}
                        >
                          <Checkbox
                            checked={selectedFolders.has(folder.path)}
                            onCheckedChange={() => toggleFolderSelected(folder.path)}
                            className="shrink-0"
                          />
                          <button
                            className="flex items-center gap-2 flex-1 min-w-0 text-left"
                            onClick={() => browseTo(folder.path)}
                            disabled={browseLoading}
                          >
                            {folder.isProject ? (
                              <FolderKanban className="h-4 w-4 shrink-0 text-primary" />
                            ) : (
                              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate">{folder.name}</span>
                            {folder.isProject && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 shrink-0 text-primary border-primary/30"
                              >
                                project
                              </Badge>
                            )}
                            <ChevronRight className="h-3 w-3 ml-auto shrink-0 text-muted-foreground/40" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground/50">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}

            {/* Name + category + add button */}
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Project Name</Label>
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Project name"
                  className="h-9 text-xs"
                />
              </div>
              <div className="w-[140px] space-y-1">
                <Label className="text-xs">Category</Label>
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Optional"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button
                onClick={handleAddProject}
                disabled={createProject.isPending || !projectPath.trim()}
                className="flex-1"
              >
                {createProject.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                <Plus className="h-4 w-4 mr-1" />
                Add Project
              </Button>
              {selectedFolders.size > 0 && (
                <Button
                  onClick={handleAddSelectedFolders}
                  disabled={createProject.isPending}
                  variant="secondary"
                  className="shrink-0"
                >
                  Add {selectedFolders.size} checked
                </Button>
              )}
            </div>
          </TabsContent>

          {/* Scan tab */}
          <TabsContent value="scan" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Directories to scan (one per line)</Label>
              <textarea
                value={scanDirs}
                onChange={(e) => setScanDirs(e.target.value)}
                placeholder={"C:/Users/me/projects\nC:/Users/me/work"}
                className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm"
                rows={3}
              />
            </div>
            <Button
              onClick={handleScan}
              disabled={scanProjects.isPending}
              variant="outline"
              className="w-full"
            >
              {scanProjects.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <FolderSearch className="h-4 w-4 mr-1" />
              )}
              Scan Directories
            </Button>

            {scanned.length > 0 && (
              <>
                <ScrollArea className="h-[200px] border rounded-md p-2">
                  <div className="space-y-2">
                    {scanned.map((p, i) => (
                      <label
                        key={i}
                        className="flex items-start gap-2 p-2 rounded hover:bg-accent cursor-pointer"
                      >
                        <Checkbox
                          checked={selected.has(i)}
                          onCheckedChange={() => toggleSelected(i)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{p.path}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.techStack.map((t) => (
                              <Badge key={t} variant="outline" className="text-[10px] px-1 py-0">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
                <Button
                  onClick={handleBulkAdd}
                  disabled={selected.size === 0 || createProject.isPending}
                  className="w-full"
                >
                  {createProject.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Add {selected.size} Project{selected.size !== 1 ? "s" : ""}
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
