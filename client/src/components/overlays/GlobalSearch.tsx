import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useProjects, useSearchTasks } from "@/hooks";
import PriorityBadge from "@/components/tasks/PriorityBadge";
import type { Task } from "@vibe-kanban/shared";

export default function GlobalSearch() {
  const { globalSearchOpen, setGlobalSearchOpen } = useAppStore();
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const { data: projects } = useProjects();
  const { data: taskResults } = useSearchTasks(query);

  const filteredProjects = projects?.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  ) ?? [];

  const handleNavigate = (path: string) => {
    navigate(path);
    setGlobalSearchOpen(false);
    setQuery("");
  };

  return (
    <Dialog open={globalSearchOpen} onOpenChange={(v) => { setGlobalSearchOpen(v); if (!v) setQuery(""); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Global Search</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects and tasks..."
            className="pl-9"
            autoFocus
          />
        </div>

        <Tabs defaultValue="all">
          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
            <TabsTrigger value="projects" className="flex-1">Projects</TabsTrigger>
            <TabsTrigger value="tasks" className="flex-1">Tasks</TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            <ScrollArea className="h-[300px]">
              {filteredProjects.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Projects</div>
                  {filteredProjects.slice(0, 5).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleNavigate(`/project/${p.id}`)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent text-left"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
              {taskResults && taskResults.length > 0 && (
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Tasks</div>
                  {taskResults.slice(0, 10).map((task: Task) => (
                    <button
                      key={task.id}
                      onClick={() => handleNavigate(`/project/${task.projectId}`)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent text-left"
                    >
                      <span className="flex-1 truncate">{task.title}</span>
                      <PriorityBadge priority={task.priority} />
                    </button>
                  ))}
                </div>
              )}
              {query.length >= 2 && filteredProjects.length === 0 && (!taskResults || taskResults.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-8">No results found</p>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="projects">
            <ScrollArea className="h-[300px]">
              {filteredProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleNavigate(`/project/${p.id}`)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent text-left"
                >
                  {p.name}
                  {p.category && <span className="text-xs text-muted-foreground">{p.category}</span>}
                </button>
              ))}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="tasks">
            <ScrollArea className="h-[300px]">
              {taskResults?.map((task: Task) => (
                <button
                  key={task.id}
                  onClick={() => handleNavigate(`/project/${task.projectId}`)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent text-left"
                >
                  <span className="flex-1 truncate">{task.title}</span>
                  <PriorityBadge priority={task.priority} />
                </button>
              ))}
              {query.length < 2 && <p className="text-xs text-muted-foreground text-center py-4">Type at least 2 characters</p>}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
