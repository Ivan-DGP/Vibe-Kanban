import { useNavigate } from "react-router-dom";
import {
  Star,
  ExternalLink,
  GitBranch,
  Inbox,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  FolderOpen,
} from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useUpdateProject } from "@/hooks";
import { TECH_STACK_COLORS } from "@/lib/constants";
import type { Project } from "@vibe-kanban/shared";

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

interface ProjectCardProps {
  project: Project;
  taskCounts?: {
    inbox: number;
    inProgress: number;
    done: number;
    approved: number;
    urgent: number;
  };
  gitBranch?: string;
}

export default function ProjectCard({ project, taskCounts, gitBranch }: ProjectCardProps) {
  const navigate = useNavigate();
  const updateProject = useUpdateProject();

  const toggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateProject.mutate({ id: project.id, input: { favorite: !project.favorite } });
  };

  return (
    <Card
      className="cursor-pointer hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 transition-all duration-200 group"
      onClick={() => navigate(`/project/${project.id}`)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
              {project.name}
            </h3>
            {project.category && (
              <span className="text-xs text-muted-foreground/70">{project.category}</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            onClick={toggleFavorite}
          >
            <Star
              className={`h-4 w-4 transition-colors ${project.favorite ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"}`}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {/* Project path */}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 truncate">
          <FolderOpen className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono">{project.path}</span>
        </div>

        {/* Tech stack badges */}
        {project.techStack.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {project.techStack.slice(0, 5).map((tech) => (
              <Badge
                key={tech}
                variant="outline"
                className={`text-[10px] px-1.5 py-0 ${TECH_STACK_COLORS[tech] || ""}`}
              >
                {tech}
              </Badge>
            ))}
            {project.techStack.length > 5 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                +{project.techStack.length - 5}
              </Badge>
            )}
          </div>
        )}

        {/* Git branch */}
        {gitBranch && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            <span className="truncate font-mono text-[11px]">{gitBranch}</span>
          </div>
        )}

        {/* Task counts */}
        {taskCounts && (
          <div className="flex items-center gap-3 text-xs pt-1 border-t border-border/40">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Inbox className="h-3 w-3" />
                  {taskCounts.inbox}
                </span>
              </TooltipTrigger>
              <TooltipContent>Inbox</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-amber-500">
                  <Loader2 className="h-3 w-3" />
                  {taskCounts.inProgress}
                </span>
              </TooltipTrigger>
              <TooltipContent>In Progress</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-emerald-500">
                  <CheckCircle2 className="h-3 w-3" />
                  {taskCounts.done}
                </span>
              </TooltipTrigger>
              <TooltipContent>Done</TooltipContent>
            </Tooltip>
            {taskCounts.approved > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1 text-emerald-600">
                    <ShieldCheck className="h-3 w-3" />
                    {taskCounts.approved}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Approved</TooltipContent>
              </Tooltip>
            )}
            {taskCounts.urgent > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1 text-red-500">
                    <AlertTriangle className="h-3 w-3" />
                    {taskCounts.urgent}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Urgent</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {/* External links */}
        {project.externalLinks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {project.externalLinks.map((link, i) => {
              // Only http(s) links are safe as hrefs; reject javascript:/data: etc.
              // (these URLs can arrive via import/Sheets sync — stored XSS vector).
              const safeUrl = isHttpUrl(link.url) ? link.url : null;
              return safeUrl ? (
                <a
                  key={i}
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {link.label}
                </a>
              ) : (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                  title={link.url}
                >
                  <ExternalLink className="h-3 w-3" />
                  {link.label}
                </span>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
