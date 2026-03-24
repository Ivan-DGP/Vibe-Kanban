import { useParams, useNavigate } from "react-router-dom";
import { useProject } from "@/hooks";
import { useAppStore } from "@/stores/appStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, GitBranch, Code, ListTodo, GitPullRequest, Settings2, FolderOpen, BookOpen, NotebookPen } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { TECH_STACK_COLORS } from "@/lib/constants";
import { useGitStatus } from "@/hooks";
import KanbanBoard from "@/components/kanban/KanbanBoard";
import WorkingOnBanner from "@/components/dashboard/WorkingOnBanner";
import CodeEditorPanel from "@/components/editor/CodeEditorPanel";
import GitPanel from "@/components/git/GitPanel";
import NotionPanel from "@/components/notion/NotionPanel";
import ProjectSettingsDialog from "@/components/dashboard/ProjectSettingsDialog";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading } = useProject(projectId);
  const { data: gitStatus } = useGitStatus(projectId);
  const { workspaceModes, setWorkspaceMode } = useAppStore();

  const mode = workspaceModes[projectId ?? ""] ?? "tasks";
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-[300px]" />
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Project not found.</p>
        <Button variant="link" onClick={() => navigate("/")}>Go to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border/60 bg-card/30">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">{project.name}</h1>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50 max-w-[300px] truncate cursor-default">
                <FolderOpen className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate font-mono">{project.path}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="font-mono text-xs">{project.path}</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1.5">
          {project.techStack.slice(0, 4).map((tech) => (
            <Badge
              key={tech}
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${TECH_STACK_COLORS[tech] || ""}`}
            >
              {tech}
            </Badge>
          ))}
        </div>

        {gitStatus?.branch && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1 px-2 py-1 rounded-md bg-secondary/50">
            <GitBranch className="h-3 w-3" />
            <span className="font-mono">{gitStatus.branch}</span>
            {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
              <span className="text-[10px]">
                {gitStatus.ahead > 0 && `↑${gitStatus.ahead}`}
                {gitStatus.behind > 0 && `↓${gitStatus.behind}`}
              </span>
            )}
          </div>
        )}

        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettingsOpen(true)}>
          <Settings2 className="h-4 w-4" />
        </Button>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 ml-2">
              <GitPullRequest className="h-3.5 w-3.5" />
              Git
            </Button>
          </SheetTrigger>
          <SheetContent className="w-[380px] sm:w-[420px] overflow-y-auto">
            <SheetTitle>Git</SheetTitle>
            <GitPanel projectId={project.id} />
          </SheetContent>
        </Sheet>

        {project.notionDatabaseId && (
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                <NotebookPen className="h-3.5 w-3.5" />
                Notion
              </Button>
            </SheetTrigger>
            <SheetContent className="w-[380px] sm:w-[420px] p-0">
              <SheetTitle className="sr-only">Notion</SheetTitle>
              <NotionPanel databaseId={project.notionDatabaseId} />
            </SheetContent>
          </Sheet>
        )}

        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border/60 bg-secondary/30 p-0.5">
          <Button
            variant={mode === "tasks" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1.5 rounded-md"
            onClick={() => setWorkspaceMode(project.id, "tasks")}
          >
            <ListTodo className="h-3.5 w-3.5" />
            Tasks
          </Button>
          <Button
            variant={mode === "editor" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1.5 rounded-md"
            onClick={() => setWorkspaceMode(project.id, "editor")}
          >
            <Code className="h-3.5 w-3.5" />
            Editor
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {mode === "tasks" ? (
          <>
            <WorkingOnBanner projectId={project.id} compact />
            <KanbanBoard projectId={project.id} projectName={project.name} />
          </>
        ) : (
          <CodeEditorPanel projectId={project.id} />
        )}
      </div>

      <ProjectSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        project={project}
      />
    </div>
  );
}
