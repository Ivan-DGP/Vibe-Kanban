import { useState, useMemo } from "react";
import { useProjects } from "@/hooks";
import { useProjectStats } from "@/hooks/useProjectStats";
import { Skeleton } from "@/components/ui/skeleton";
import WorkingOnBanner from "@/components/dashboard/WorkingOnBanner";
import CategoryFilter from "@/components/dashboard/CategoryFilter";
import ProjectCard from "@/components/dashboard/ProjectCard";
import AddProjectDialog from "@/components/dashboard/AddProjectDialog";

export default function Dashboard() {
  const { data: projects, isLoading } = useProjects();
  const [filter, setFilter] = useState("all");

  const categories = useMemo(() => {
    if (!projects) return [];
    const cats = new Set(projects.map((p) => p.category).filter(Boolean) as string[]);
    return Array.from(cats).sort();
  }, [projects]);

  const filtered = useMemo(() => {
    if (!projects) return [];
    if (filter === "all") return projects;
    if (filter === "favorites") return projects.filter((p) => p.favorite);
    return projects.filter((p) => p.category === filter);
  }, [projects, filter]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground/70 mt-0.5">
            {projects?.length ?? 0} project{(projects?.length ?? 0) !== 1 ? "s" : ""}
          </p>
        </div>
        <AddProjectDialog />
      </div>

      <WorkingOnBanner />

      {categories.length > 0 && (
        <CategoryFilter
          categories={categories}
          activeFilter={filter}
          onFilterChange={setFilter}
        />
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[180px] rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <div className="h-16 w-16 rounded-2xl bg-secondary/50 flex items-center justify-center mb-4">
            <span className="text-2xl">+</span>
          </div>
          <p className="text-lg font-medium">No projects yet</p>
          <p className="text-sm mt-1 text-muted-foreground/60">Add a project manually or scan your directories</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((project) => (
            <DashboardProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardProjectCard({ project }: { project: import("@vibe-kanban/shared").Project }) {
  const { data } = useProjectStats(project.id);
  return (
    <ProjectCard
      project={project}
      taskCounts={data?.taskCounts}
      gitBranch={data?.gitBranch ?? undefined}
    />
  );
}
